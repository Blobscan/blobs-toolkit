DATA=$(http https://api.blobscan.com/transactions rollup==optimism)
TX_IDS=$(echo $DATA | jq -r '.transactions[] | .hash')
for tx in $TX_IDS; do
    echo $tx
    poetry run ./retrieve_blob.py $tx
    poetry run ./decode_opstack_blob.py ./$tx.blob
    echo -e "\n\n\n\n"
done
