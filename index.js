import * as CardanoWasm from "@emurgo/cardano-serialization-lib-browser"
import { textPartFromWalletChecksumImagePart } from "@emurgo/cip4-js"
import { createIcon } from "@download/blockies"
import { getTtl, utxoJSONToTransactionInput } from './utils'
import { bytesToHex, hexToBytes } from './coreUtils';
import { Buffer } from "buffer"

const gameScore = document.querySelector("#game-score");
const rewardNote = document.querySelector("#reward-note");
const refreshNote = document.querySelector("#refresh-note");
const cardanoAccessLabel = document.querySelector('#request-access-label')
const cardanoAccessBtn = document.querySelector('#request-access')
const connectionStatus = document.querySelector('#connection-status')
const walletPlateSpan = document.querySelector('#wallet-plate')
const walletIconSpan = document.querySelector('#wallet-icon')
const getAccountBalance = document.querySelector('#get-balance')
const alertEl = document.querySelector('#alert')
const spinner = document.querySelector('#spinner')
const mintNFT = document.querySelector("#mint-NFT");

let accessGranted = false;
let cardanoApi;
let returnType = "cbor";
let utxos;
let accountBalance;
let transactionHex;
let rewardScores = [200, 500, 1000, 2000, 5000]
let rewardNFTNames = ["FlappyCube: Newbie", "FlappyCube: Novice", "FlappyCube: Pro", "FlappyCube: Master", "FlappyCube: Legend"]
let rewardIndex;

function isCBOR() {
  return returnType === "cbor";
}

const mkcolor = (primary, secondary, spots) => ({ primary, secondary, spots });
const COLORS = [
  mkcolor("#E1F2FF", "#17D1AA", "#A80B32"),
  mkcolor("#E1F2FF", "#FA5380", "#0833B2"),
  mkcolor("#E1F2FF", "#F06EF5", "#0804F7"),
  mkcolor("#E1F2FF", "#EBB687", "#852D62"),
  mkcolor("#E1F2FF", "#F59F9A", "#085F48"),
];

function createBlockiesIcon(seed) {
  const colorIdx = hexToBytes(seed)[0] % COLORS.length;
  const color = COLORS[colorIdx];
  return createIcon({
    seed,
    size: 7,
    scale: 5,
    bgcolor: color.primary,
    color: color.secondary,
    spotcolor: color.spots,
  });
}

function onApiConnectied(api) {
  toggleSpinner("hide");
  let walletDisplay = "an anonymous Yoroi Wallet";

  api.experimental.setReturnType(returnType);

  const auth = api.experimental.auth && api.experimental.auth();
  const authEnabled = auth && auth.isEnabled();

  if (authEnabled) {
    const walletId = auth.getWalletId();
    const pubkey = auth.getWalletPubkey();
    console.log(
      "Auth acquired successfully: ",
      JSON.stringify({ walletId, pubkey })
    );
    const walletPlate = textPartFromWalletChecksumImagePart(walletId);
    walletDisplay = `Yoroi Wallet ${walletPlate}`;
    walletIconSpan.appendChild(createBlockiesIcon(walletId));
    getAccountBalance.classList.remove("d-none"); 
  }

  walletPlateSpan.innerHTML = walletDisplay;
  toggleConnectionUI("status");
  accessGranted = true;
  window.cardanoApi = cardanoApi = api;

  api.experimental.onDisconnect(() => {
    alertWarrning(`Disconnected from ${walletDisplay}`);
    toggleConnectionUI("button");
    walletPlateSpan.innerHTML = "";
    walletIconSpan.innerHTML = "";
    mintNFT.classList.add("d-none");
  });

  if (authEnabled) {
    console.log("Testing auth signatures");
    const messageJson = JSON.stringify({
      type: "this is a random test message object",
      rndValue: Math.random(),
    });
    const messageHex = bytesToHex(messageJson);
    console.log(
      "Signing randomized message: ",
      JSON.stringify({
        messageJson,
        messageHex,
      })
    );
    const start = performance.now();
    auth.signHexPayload(messageHex).then(
      (sig) => {
        const elapsed = performance.now() - start;
        console.log(`Signature created in ${elapsed} ms`);
        console.log("Signature received: ", sig);
        console.log("Verifying signature against the message");
        auth.checkHexPayload(messageHex, sig).then(
          (r) => {
            console.log("Signature matches message: ", r);
          },
          (e) => {
            console.error("Sig check failed", e);
          }
        );
      },
      (err) => {
        console.error("Sig failed", err);
      }
    );
  }
  // hacky fix to assert wallet is testnet
  // while getNetworkId() has not yet been implemented
  cardanoApi.getChangeAddress().then(function (address) {
    if (addressesFromCborIfNeeded([address])[0].slice(0, 9) != "addr_test") {
      alert("Non testnet wallet detected, demo app was built for testnet, functions will not work as intended, funds are at risk, please disonnect wallet and reconnect")
    }
  })
}

function reduceWasmMultiasset(multiasset, reducer, initValue) {
  let result = initValue;
  if (multiasset) {
    const policyIds = multiasset.keys();
    for (let i = 0; i < policyIds.len(); i++) {
      const policyId = policyIds.get(i);
      const assets = multiasset.get(policyId);
      const assetNames = assets.keys();
      for (let j = 0; j < assetNames.len(); j++) {
        const name = assetNames.get(j);
        const amount = assets.get(name);
        const policyIdHex = bytesToHex(policyId.to_bytes());
        const encodedName = bytesToHex(name.name());
        result = reducer(result, {
          policyId: policyIdHex,
          name: encodedName,
          amount: amount.to_str(),
          assetId: `${policyIdHex}.${encodedName}`,
        });
      }
    }
  }
  return result;
}

cardanoAccessBtn.addEventListener("click", () => {
  toggleSpinner("show");
  const requestIdentification = true;

  cardano.yoroi.enable({ requestIdentification }).then(
    function (api) {
      onApiConnectied(api);
    },
    function (err) {
      toggleSpinner("hide");
      alertError(`Error: ${err}`);
    }
  );
});

function getBalanceFunc(){
  toggleSpinner("show");
  const tokenId = "*";
  cardanoApi.getBalance(tokenId).then(function (balance) {
    //console.log("[getBalance]", balance);
    toggleSpinner("hide");
    let balanceJson = balance;
    if (isCBOR()) {
      if (tokenId !== "*") {
        //alertSuccess(`Asset Balance: ${balance} (asset: ${tokenId})`);
        return;
      }
      const value = CardanoWasm.Value.from_bytes(hexToBytes(balance));
      balanceJson = { default: value.coin().to_str() };
      balanceJson.assets = reduceWasmMultiasset(
        value.multiasset(),
        (res, asset) => {
          res[asset.assetId] = asset.amount;
          return res;
        },
        {}
      );
    }
    accountBalance = balanceJson;
    getAccountBalance.classList.add("d-none");
    rewardNote.classList.remove("d-none");
    var rewardData = getRewardIndex(gameScore.value);
    if(rewardData.nftIndex == -1){
      rewardNote.innerHTML = "Reach score " + rewardScores[rewardData.highestNFT + 1] + " to get your next reward";
      refreshNote.classList.remove("d-none");
    }
    else{
      rewardNote.innerHTML = "You got <b>" + rewardNFTNames[rewardData.nftIndex] + "</b> NFT!";
      rewardIndex = rewardData.nftIndex;
      mintNFT.classList.remove("d-none");
    }
    //alertSuccess(`Account Balance: ${JSON.stringify(balanceJson, null, 2)}`);
  });
}

function getRewardIndex(score){
  var assetMetadata = getAssetsMetadataFunc();
  var indexData = {
    highestNFT: 0,
    nftIndex: -1
  };

  for (var i = 0; i < rewardScores.length; i++){
    if(score > rewardScores[i]){
      var hasNFT = false;

      for(var j = 0; j < assetMetadata.length; j++){
        if(assetMetadata[j].name == rewardNFTNames[i]){
          hasNFT = true;
          indexData.highestNFT = i;
          break;
        }
      }

      if(!hasNFT){
        indexData.nftIndex = i;
        break;
      }
    }
  }

  return indexData;
}

getAccountBalance.addEventListener("click", () => {
  if (!accessGranted) {
    alertError("Should request access first");
  } else {
    getBalanceFunc();
  }
});

function addressesFromCborIfNeeded(addresses) {
  return isCBOR()
    ? addresses.map(
      (a) =>
        CardanoWasm.Address.from_bytes(hexToBytes(a)).to_bech32()
    )
    : addresses;
}

function addressToCbor(address) {
  return bytesToHex(CardanoWasm.Address.from_bech32(address).to_bytes());
}

function mapCborUtxos(cborUtxos) {
  return cborUtxos.map((hex) => {
    const u = CardanoWasm.TransactionUnspentOutput.from_bytes(hexToBytes(hex));
    const input = u.input();
    const output = u.output();
    const txHash = bytesToHex(input.transaction_id().to_bytes());
    const txIndex = input.index();
    const value = output.amount();
    return {
      utxo_id: `${txHash}${txIndex}`,
      tx_hash: txHash,
      tx_index: txIndex,
      receiver: output.address().to_bech32(),
      amount: value.coin().to_str(),
      assets: reduceWasmMultiasset(
        value.multiasset(),
        (res, asset) => {
          res.push(asset);
          return res;
        },
        []
      ),
    };
  });
}

function valueRequestObjectToWasmHex(requestObj) {
  const { amount, assets } = requestObj;
  const result = CardanoWasm.Value.new(
    CardanoWasm.BigNum.from_str(String(amount))
  );
  if (assets != null) {
    if (typeof assets !== "object") {
      throw "Assets is expected to be an object like `{ [policyId]: { [assetName]: amount } }`";
    }
    const wmasset = CardanoWasm.MultiAsset.new();
    for (const [policyId, assets2] of Object.entries(assets)) {
      if (typeof assets2 !== "object") {
        throw "Assets is expected to be an object like `{ [policyId]: { [assetName]: amount } }`";
      }
      const wassets = CardanoWasm.Assets.new();
      for (const [assetName, amount] of Object.entries(assets2)) {
        wassets.insert(
          CardanoWasm.AssetName.new(hexToBytes(assetName)),
          CardanoWasm.BigNum.from_str(String(amount))
        );
      }
      wmasset.insert(
        CardanoWasm.ScriptHash.from_bytes(hexToBytes(policyId)),
        wassets
      );
    }
    result.set_multiasset(wmasset);
  }
  return bytesToHex(result.to_bytes());
}

window._getUtxos = function (value) {
  if (!accessGranted) {
    alertError("Should request access first");
    return;
  }
  toggleSpinner("show");
  if (value != null && typeof value !== "string") {
    value = valueRequestObjectToWasmHex(value);
  }
  cardanoApi.getUtxos(value).then((utxosResponse) => {
    toggleSpinner("hide");
    if (utxosResponse.length === 0) {
      alertWarrning("NO UTXOS");
    } else {
      utxos = isCBOR() ? mapCborUtxos(utxosResponse) : utxosResponse;
      alertSuccess(
        `<h2>UTxO (${utxos.length}):</h2><pre>` +
        JSON.stringify(utxos, undefined, 2) +
        "</pre>"
      );
    }
  });
};

mintNFT.addEventListener('click', async () => {
  const NFTIndex = 1;
  toggleSpinner("show");

  if (!accessGranted) {
    alertError("Should request access first");
    return;
  }

  const txBuilder = getTxBuilder()
  const hexInputUtxos = await cardanoApi.getUtxos("2000000")

  // the key hash will be needed for our policy id
  let wasmKeyHash

  // add utxos for amount
  const txInputsBuilder = CardanoWasm.TxInputsBuilder.new()
  for (let i = 0; i < hexInputUtxos.length; i++) {
    const wasmUtxo = CardanoWasm.TransactionUnspentOutput.from_bytes(hexToBytes(hexInputUtxos[i]))
    txInputsBuilder.add_input(wasmUtxo.output().address(), wasmUtxo.input(), wasmUtxo.output().amount())
    if (i == 0) {
      wasmKeyHash = CardanoWasm.BaseAddress.from_address(wasmUtxo.output().address()).payment_cred().to_keyhash()
    }
  }
  txBuilder.set_inputs(txInputsBuilder)

  // Add the keyhash script to ensure the NFT can only be minted by the corresponding wallet
  const keyHashScript = CardanoWasm.NativeScript.new_script_pubkey(
    CardanoWasm.ScriptPubkey.new(wasmKeyHash)
  );
  const ttl = getTtl();

  // We then need to add a timelock to ensure the NFT won't be minted again after the given expiry slot
  const timelock = CardanoWasm.TimelockExpiry.new(ttl);
  const timelockScript = CardanoWasm.NativeScript.new_timelock_expiry(timelock);

  // Then the policy script is an "all" script of these two scripts
  const scripts = CardanoWasm.NativeScripts.new();
  scripts.add(timelockScript);
  scripts.add(keyHashScript);

  const policyScript = CardanoWasm.NativeScript.new_script_all(
    CardanoWasm.ScriptAll.new(scripts)
  );

  const metadataObj = {
    [Buffer.from(policyScript.hash(0).to_bytes()).toString("hex")]: {
      [rewardNFTNames[rewardIndex]]: {
        name: rewardNFTNames[rewardIndex],
        description: "Badge of Flappy Cube game"
      },
    },
  };

  const changeAddress = await cardanoApi.getChangeAddress()
  const wasmChangeAddress = CardanoWasm.Address.from_bytes(hexToBytes(changeAddress))
  let outputBuilder = CardanoWasm.TransactionOutputBuilder.new();
  outputBuilder = outputBuilder.with_address(wasmChangeAddress);

  txBuilder.add_mint_asset_and_output_min_required_coin(
    policyScript,
    CardanoWasm.AssetName.new(Buffer.from(rewardNFTNames[rewardIndex], "utf8")),
    CardanoWasm.Int.new_i32(1),
    outputBuilder.next())

  txBuilder.set_ttl(ttl)
  txBuilder.add_json_metadatum(CardanoWasm.BigNum.from_str('721'), JSON.stringify(metadataObj))
  txBuilder.add_change_if_needed(wasmChangeAddress)

  const unsignedTransactionHex = bytesToHex(txBuilder.build_tx().to_bytes())

  cardanoApi.signTx(unsignedTransactionHex)
    .then((witnessSetHex) => {
      const witnessSet = CardanoWasm.TransactionWitnessSet.from_bytes(
        hexToBytes(witnessSetHex)
      );
      const tx = CardanoWasm.Transaction.from_bytes(
        hexToBytes(unsignedTransactionHex)
      );
      const transaction = CardanoWasm.Transaction.new(
        tx.body(),
        witnessSet,
        tx.auxiliary_data(),
      );
      transactionHex = bytesToHex(transaction.to_bytes())
      alertSuccess('Signing tx succeeded: ' + transactionHex)
      //setSignedTxAlerts("Mint NFT", transactionHex)

      toggleSpinner("show");
      cardanoApi
        .submitTx(transactionHex)
        .then((txId) => {
          toggleSpinner("hide");
          alertSuccess(`Transaction ${txId} submitted`);
          mintNFT.classList.add("d-none");
          refreshNote.classList.remove("d-none");
          refreshNote.innerHTML = "Reward claimed! Refresh page to retry"
        })
        .catch((error) => {
          toggleSpinner("hide");
          alertWarrning(`Transaction submission failed: ${JSON.stringify(error)}`);
        });
    }).catch(error => {
      console.error(error)
      toggleSpinner('hide')
      alertWarrning('Signing tx fails')
    })
})

function getAssetsMetadataFunc(){
  let metadatum = [];

  const assetIds = Object.keys(accountBalance.assets);

  for (let i = 0; i < assetIds.length; i++) {
    const splitId = assetIds[i].split(".");
    const assetPolicy = splitId[0];
    const assetName = splitId[1];
    const assetNameStr = `${Buffer.from(assetName, "hex").toString("utf-8")}`;
    metadatum.push({"policy": assetPolicy, "name": assetNameStr});
  }

  return metadatum;
}

/*getAssetsMetadata.addEventListener('click', async () => {
  toggleSpinner('show')
  if (!accountBalance) {
    alertError("Should get account balance first");
    return;
  }

  let metadatum = [];

  const assetIds = Object.keys(accountBalance.assets);

  for (let i = 0; i < assetIds.length; i++) {
    const splitId = assetIds[i].split(".");
    const assetPolicy = splitId[0];
    const assetName = splitId[1];
    const metadataResponse = await axios.post(
      "https://testnet-backend.yoroiwallet.com/api/multiAsset/metadata",
      {
        assets: [
          {
            name: `${Buffer.from(assetName, "hex").toString("utf-8")}`,
            policy: assetPolicy,
          },
        ],
      }
    );
    const metadata =
      metadataResponse.data[
      `${assetPolicy}.${Buffer.from(assetName, "hex").toString("utf-8")}`
      ];
    if (metadata) {
      for (let i = 0; i < metadata.length; i++) {
        metadatum.push(metadata[i]);
      }
    }
  }
  alertSuccess(
    `<h2>Assets (${metadatum.length}):</h2><pre>` +
    JSON.stringify(metadatum, undefined, 2) +
    "</pre>"
  );
  toggleSpinner("hide");
});*/

function getTxBuilder() {
  return CardanoWasm.TransactionBuilder.new(
    CardanoWasm.TransactionBuilderConfigBuilder.new()
      // all of these are taken from the mainnet genesis settings
      // linear fee parameters (a*size + b)
      .fee_algo(
        CardanoWasm.LinearFee.new(
          CardanoWasm.BigNum.from_str("44"),
          CardanoWasm.BigNum.from_str("155381")
        )
      )
      .coins_per_utxo_word(CardanoWasm.BigNum.from_str('34482'))
      .pool_deposit(CardanoWasm.BigNum.from_str('500000000'))
      .key_deposit(CardanoWasm.BigNum.from_str('2000000'))
      .ex_unit_prices(CardanoWasm.ExUnitPrices.new(
        CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str("577"), CardanoWasm.BigNum.from_str("10000")),
        CardanoWasm.UnitInterval.new(CardanoWasm.BigNum.from_str("721"), CardanoWasm.BigNum.from_str("10000000"))
      ))
      .max_value_size(5000)
      .max_tx_size(16384)
      .build()
  );
}

function alertError(text) {
  toggleSpinner('hide');
  alertEl.className = 'alert alert-danger overflow-auto'
  alertEl.innerHTML = text
}

function alertSuccess(text) {
  alertEl.className = 'alert alert-success overflow-auto'
  alertEl.innerHTML = text
}

function alertWarrning(text) {
  alertEl.className = 'alert alert-warning overflow-auto'
  alertEl.innerHTML = text
}

function toggleSpinner(status) {
  if (status === "show") {
    spinner.className = "spinner-border";
    alertEl.className = "d-none";
  } else {
    spinner.className = "d-none";
  }
}

function toggleConnectionUI(status) {
  if (status === "button") {
    connectionStatus.classList.add("d-none");
    cardanoAccessBtn.classList.remove("d-none");
    cardanoAccessLabel.classList.remove("d-none");
  } else {
    cardanoAccessBtn.classList.add("d-none");
    cardanoAccessLabel.classList.add("d-none");
    connectionStatus.classList.remove("d-none");
  }
}

function setSignedTxAlerts(txType, txHex) {
  document.querySelector("#signed-tx-type").textContent = txType
  document.querySelector("#signed-tx-hex").textContent = txHex
}

function load() {
  if (typeof window.cardano === "undefined") {
    alertError("Cardano API not found");
    wait = false;
  } else {
    cardano.yoroi
      .enable({ requestIdentification: true, onlySilent: true })
      .then(
        (api) => {
          console.log("successful silent reconnection");
          onApiConnectied(api);
        },
        (err) => {
          if (String(err).includes("onlySilent:fail")) {
            console.log("no silent re-connection available");
          } else {
            console.error(
              "Silent reconnection failed for unknown reason!",
              err
            );
          }
          //toggleSpinner("hide");
          //toggleConnectionUI("button");
        }
      );
  }
}

load();
