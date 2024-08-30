#!/usr/bin/env python
#
# Usage:
# ./retrieve_blob.py [txId]
#
import requests
import sys

URL_BLOBS = "https://api.blobscan.com/blobs/"
URL_TXS = "https://api.blobscan.com/transactions/"


def write_hex_to_file(hex_string, file_path):
    hex_string = hex_string[2:]
    hex_data = bytes.fromhex(hex_string)
    with open(file_path, 'wb') as file:
        file.write(hex_data)
    print(f"Written {file_path}")


if len(sys.argv) == 1:
    tx = "0x353c6f31903147f8d490c28e556caafd7a9fad8b3bc4fd210ae800ee24749adb"
else:
    tx = sys.argv[1]
response = requests.get(URL_TXS + tx)
data = response.json()
blobs = data["blobs"]
blob_data = "0x"

print(f"Transaction contains {len(blobs)} blobs")

for blob in blobs:
    index = blob["index"]
    versioned_hash = blob["versionedHash"]
    print(f"Retrieving blob index={index} {versioned_hash}")
    response = requests.get(URL_BLOBS + versioned_hash)
    data = response.json()
    blob_data += data["data"][2:]  # Remove '0x'
    # file_path = f"{tx}_{index}.hex"
    # write_hex_to_file(data["data"], file_path)

file_path = f"{tx}.blob"
write_hex_to_file(blob_data, file_path)
