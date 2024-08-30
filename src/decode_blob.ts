import * as fs from 'fs';
import * as pako from 'pako'; // For zlib decompression
import { rlp } from 'ethereumjs-util'; // For RLP decoding

function chunks(array: Buffer, size: number): Buffer[] {
    const result: Buffer[] = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

function readVarInt(buffer: Buffer): Buffer {
    const r: number[] = [];
    let i = 0;
    while (i < buffer.length) {
        const a = buffer[i++];
        r.push(a);
        if ((a & 0b10000000) === 0) break;
    }
    return Buffer.from(r);
}

function readBitlist(length: number, buffer: Buffer): boolean[] {
    const result: boolean[] = [];
    for (let i = 0; i < length; i++) {
        const byte = buffer[i];
        const bits: boolean[] = [];
        for (let j = 0; j < 8; j++) {
            bits.push(((byte >> (7 - j)) & 1) === 1);
        }
        result.push(...bits.slice(0, Math.min(8, length - i * 8)));
    }
    return result;
}

interface DecompressedData {
    timestampSinceL2Genesis: number;
    lastL1OriginNumber: number;
    parentL2BlockHash: string;
    L1OriginBlockHash: string;
    l2BlocksNumber: number;
    numberChangedByL1Origin: boolean[];
    totalTxs: number;
    contractCreationTxsNumber: boolean[];
    // Additional fields can be added here as needed
}

function decompressOptimismData(filename: string): DecompressedData {
    const blobs = fs.readFileSync(filename);

    const datas: Buffer[] = [];
    for (const blob of chunks(blobs, 131072)) {
        if (blob[1] !== 0) throw new Error("Invalid blob version");

        const declaredLength = blob.readUIntBE(2, 3);
        let blobData = Buffer.alloc(0);

        for (const chunk of chunks(blob, 128)) {
            const byteA = chunk[32 * 0];
            const byteB = chunk[32 * 1];
            const byteC = chunk[32 * 2];
            const byteD = chunk[32 * 3];

            if ((byteA | byteB | byteC | byteD) & 0b11000000) throw new Error("Invalid blob format");

            const tailA = chunk.slice(32 * 0 + 1, 32 * 1);
            const tailB = chunk.slice(32 * 1 + 1, 32 * 2);
            const tailC = chunk.slice(32 * 2 + 1, 32 * 3);
            const tailD = chunk.slice(32 * 3 + 1, 32 * 4);

            const x = (byteA & 0b00111111) | ((byteB & 0b00110000) << 2);
            const y = (byteB & 0b00001111) | ((byteD & 0b00001111) << 4);
            const z = (byteC & 0b00111111) | ((byteD & 0b00110000) << 2);

            const result = Buffer.concat([
                tailA, Buffer.from([x]),
                tailB, Buffer.from([y]),
                tailC, Buffer.from([z]),
                tailD
            ]);

            if (result.length !== 4 * 31 + 3) throw new Error("Invalid result length");

            blobData = Buffer.concat([blobData, result]);
        }

        datas.push(blobData.slice(4, declaredLength + 4));
    }

    let channel = Buffer.alloc(0);
    for (let data of datas) {
        if (data[0] !== 0) throw new Error("Invalid derivation version");
        data = data.slice(1); // strip prefix byte

        while (data.length > 0) {
            const channelId = data.slice(0, 16).toString('hex');
            const frameNum = data.readUInt16BE(16);
            const frameLength = data.readUInt32BE(18);
            const end = 16 + 2 + 4 + frameLength + 1;
            const frameData = data.slice(22, end - 1);
            channel = Buffer.concat([channel, frameData]);
            data = data.slice(end);
        }
    }

    const decompressed = pako.inflate(channel);
    const decoded = rlp.decode(Buffer.from(decompressed)) as Buffer;

    // Read fields
    const result: DecompressedData = {
        timestampSinceL2Genesis: 0,
        lastL1OriginNumber: 0,
        parentL2BlockHash: '',
        L1OriginBlockHash: '',
        l2BlocksNumber: 0,
        numberChangedByL1Origin: [],
        totalTxs: 0,
        contractCreationTxsNumber: [],
    };

    let pointer = 0;

    if (decoded[pointer++] !== 0x01) throw new Error("Decoded value is not a span batch");

    const varintResult1 = readVarInt(decoded.slice(pointer));
    result.timestampSinceL2Genesis = varintResult1.readUIntBE(0, varintResult1.length);
    pointer += varintResult1.length;

    const varintResult2 = readVarInt(decoded.slice(pointer));
    result.lastL1OriginNumber = varintResult2.readUIntBE(0, varintResult2.length);
    pointer += varintResult2.length;

    result.parentL2BlockHash = decoded.slice(pointer, pointer + 20).toString('hex');
    pointer += 20;

    result.L1OriginBlockHash = decoded.slice(pointer, pointer + 20).toString('hex');
    pointer += 20;

    const varintResult3 = readVarInt(decoded.slice(pointer));
    result.l2BlocksNumber = varintResult3.readUIntBE(0, varintResult3.length);
    pointer += varintResult3.length;

    result.numberChangedByL1Origin = readBitlist(result.l2BlocksNumber, decoded.slice(pointer));
    pointer += Math.ceil(result.l2BlocksNumber / 8);

    const totalTxs: number[] = [];
    for (let i = 0; i < result.l2BlocksNumber; i++) {
        const txVarInt = readVarInt(decoded.slice(pointer));
        totalTxs.push(txVarInt.readUIntBE(0, txVarInt.length));
        pointer += txVarInt.length;
    }
    result.totalTxs = totalTxs.reduce((acc, num) => acc + num, 0);

    result.contractCreationTxsNumber = readBitlist(result.totalTxs, decoded.slice(pointer));
    pointer += Math.ceil(result.contractCreationTxsNumber.length / 8);

    return result;
}

// Example usage:
const result = decompressOptimismData('opstack_blobs_19538908.bin');
console.log(result);

