const fs = require('fs');
const pako = require('pako'); // For zlib decompression
const rlp = require('ethereumjs-util').rlp; // For RLP decoding

function chunks(array, size) {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
}

function readVarInt(buffer) {
    let r = [];
    let i = 0;
    while (i < buffer.length) {
        const a = buffer[i++];
        r.push(a);
        if ((a & 0b10000000) === 0) break;
    }
    return Buffer.from(r);
}

function readBitlist(length, buffer) {
    let result = [];
    for (let i = 0; i < length; i++) {
        const byte = buffer[i];
        const bits = [];
        for (let j = 0; j < 8; j++) {
            bits.push(((byte >> (7 - j)) & 1) === 1);
        }
        result.push(...bits.slice(0, Math.min(8, length - i * 8)));
    }
    return result;
}

function decompressOptimismData(filename) {
    // Read file as binary
    const blobs = fs.readFileSync(filename);

    let datas = [];
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
            console.log(channelId);
            const frameNum = data.readUInt16BE(16);
            console.log(frameNum);
            const frameLength = data.readUInt32BE(18);
            console.log(frameLength)
            const end = 16 + 2 + 4 + frameLength + 1;
            console.log("end", end);
            const frameData = data.slice(22, end - 1);
            console.log("frameData");
            console.log(frameData.slice(0, 100));
            channel = Buffer.concat([channel, frameData]);
            data = data.slice(end);
        }
    }
    console.log(channel);

    const decompressed = pako.inflate(channel);
    console.log(decompressed);
    const decoded = rlp.decode(Buffer.from(decompressed));

    // Read fields
    const result = {};
    const batch = Buffer.from(decoded);
    let pointer = 0;

    if (batch[pointer++] !== 0x01) throw new Error("Decoded value is not a span batch");

    const varintResult1 = readVarInt(batch.slice(pointer));
    result.timestampSinceL2Genesis = varintResult1.readUIntBE(0, varintResult1.length);
    pointer += varintResult1.length;

    const varintResult2 = readVarInt(batch.slice(pointer));
    result.lastL1OriginNumber = varintResult2.readUIntBE(0, varintResult2.length);
    pointer += varintResult2.length;

    result.parentL2BlockHash = batch.slice(pointer, pointer + 20).toString('hex');
    pointer += 20;

    result.L1OriginBlockHash = batch.slice(pointer, pointer + 20).toString('hex');
    pointer += 20;

    const varintResult3 = readVarInt(batch.slice(pointer));
    result.l2BlocksNumber = varintResult3.readUIntBE(0, varintResult3.length);
    pointer += varintResult3.length;

    result.numberChangedByL1Origin = readBitlist(result.l2BlocksNumber, batch.slice(pointer));
    pointer += Math.ceil(result.l2BlocksNumber / 8);

    const totalTxs = [];
    for (let i = 0; i < result.l2BlocksNumber; i++) {
        const txVarInt = readVarInt(batch.slice(pointer));
        totalTxs.push(txVarInt.readUIntBE(0, txVarInt.length));
        pointer += txVarInt.length;
    }
    result.totalTxs = totalTxs.reduce((acc, num) => acc + num, 0);

    result.contractCreationTxsNumber = readBitlist(result.totalTxs, batch.slice(pointer));
    pointer += Math.ceil(result.contractCreationTxsNumber / 8);

    // Additional fields as needed...

    return result;
}

// Example usage:
const result = decompressOptimismData('opstack_blobs_19538908.bin');
console.log(result);
