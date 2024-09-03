import * as fs from 'fs';
import * as zlib from 'zlib'; // Use Node.js built-in zlib module
import { rlp } from 'ethereumjs-util'; // For RLP decoding

function chunks(array: Buffer, size: number): Buffer[] {
    const result: Buffer[] = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

function readVarInt(buffer: Buffer, start: number): { value: number; newPosition: number } {
    let result = 0;
    let shift = 0;
    let position = start;

    while (position < buffer.length) {
        const byte = buffer[position++];
        result |= (byte & 0x7f) << shift;
        shift += 7;
        if ((byte & 0x80) === 0) break;
    }

    return { value: result, newPosition: position };
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

    let channel = Buffer.alloc(0, "", 'hex');
    for (let data of datas) {
        if (data[0] !== 0) throw new Error("Invalid derivation version");
        data = data.slice(1); // strip prefix byte

        while (data.length > 0) {
            const channelId = data.slice(0, 16).toString('hex');
            const frameNum = data.readUInt16BE(16);
            const frameLength = data.readUInt32BE(18);
            const end = 16 + 2 + 4 + frameLength + 1;
            const frameData = data.slice(22, end - 1);
            console.log(frameData);
            channel = Buffer.concat([channel, frameData]);
            data = data.slice(end);
        }
    }

    // Debugging: Check if the channel buffer is not empty
    console.log(`Channel length: ${channel.length}`);
    console.log(`Channel (first 100 bytes): ${channel.slice(0, 100).toString('hex')}`);

    console.log("channel", typeof(channel));
    console.log(channel);
    console.log(channel.slice(-50));
    // FIXME: Error: unexpected end of file
    //decompressed = zlib.inflateSync(channel);
    // const decompressed = zlib.inflateSync(channel.toString());
    // const decompressed = zlib.inflateSync(channel);
    // const decompressed = zlib.inflateSync(Buffer.from(channel));
    // const decompressed = zlib.inflateSync(Buffer.from(channel.toString()));
    const MAX_BYTES_PER_CHANNEL = 10_000_000;
    const decompressed = zlib.createInflate({ maxOutputLength: MAX_BYTES_PER_CHANNEL })
    // TODO: CHeck how this is made at decompressBatches()
    // https://github.com/blocktorch-xyz/optimism-batch-decoder/blob/main/src/batches/batch.ts
    const decompressStream = stream.Readable.from(inputBuffer);
    console.log(`Decompressed length: ${decompressed.length}`);
    console.log(`Decompressed (first 100 bytes): ${decompressed.slice(0, 100).toString('hex')}`);

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

    let varintResult = readVarInt(decoded, pointer);
    result.timestampSinceL2Genesis = varintResult.value;
    pointer = varintResult.newPosition;

    varintResult = readVarInt(decoded, pointer);
    result.lastL1OriginNumber = varintResult.value;
    pointer = varintResult.newPosition;

    result.parentL2BlockHash = decoded.slice(pointer, pointer + 20).toString('hex');
    pointer += 20;

    result.L1OriginBlockHash = decoded.slice(pointer, pointer + 20).toString('hex');
    pointer += 20;

    varintResult = readVarInt(decoded, pointer);
    result.l2BlocksNumber = varintResult.value;
    pointer = varintResult.newPosition;

    result.numberChangedByL1Origin = readBitlist(result.l2BlocksNumber, decoded.slice(pointer));
    pointer += Math.ceil(result.l2BlocksNumber / 8);

    const totalTxs: number[] = [];
    for (let i = 0; i < result.l2BlocksNumber; i++) {
        varintResult = readVarInt(decoded, pointer);
        totalTxs.push(varintResult.value);
        pointer = varintResult.newPosition;
    }
    result.totalTxs = totalTxs.reduce((acc, num) => acc + num, 0);

    result.contractCreationTxsNumber = readBitlist(result.totalTxs, decoded.slice(pointer));
    pointer += Math.ceil(result.contractCreationTxsNumber.length / 8);

    return result;
}

// Example usage:
const result = decompressOptimismData('opstack_blobs_19538908.bin');
console.log(result);
