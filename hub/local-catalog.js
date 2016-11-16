var Promise = require('bluebird');
var fs = require('fs');
var os = require('os');
var jsonio = require('./json-io.js');

function LocalCatalog(web3, workAbi, licenseAbi, loggerAbi, loggerAddress) {
  this.web3 = web3;
  this.workAbi = workAbi;
  this.licenseAbi = licenseAbi;
  this.loggerAbi = loggerAbi;
  this.loggerAddress = loggerAddress;
  this.licenseEventList = ['licenseReleasedEvent'];
  this.indexName = os.homedir() + "/.musicoin/local-catalog.json";
  this.releaseEventFilter = {stopWatching: function(){}};
}

LocalCatalog.prototype.startIndexing = function() {
  this.loadIndexState()
    .bind(this)
    .then(function(index) {
      this.pppIndex = index;
      console.log("Starting up indexer...");
      this.loggerContract = this.web3.eth.contract(this.loggerAbi).at(this.loggerAddress);
      this.releaseEventFilter = this.loggerContract.allEvents({fromBlock: this.pppIndex.lastBlock, toBlock:'latest'});
      this.releaseEventFilter.watch(function(err, eventEntry) {
        if (!err) {
          if ('licenseReleasedEvent' == eventEntry.event) {
            this.updateLicense(eventEntry.args.sender, eventEntry.blockNumber)
              .bind(this)
              .then(function() {
                this.pppIndex.lastBlock = eventEntry.blockNumber;
              })
              .then(function() {
                this.saveIndexState();
              });
          }
        }
      }.bind(this));
    });
};

LocalCatalog.prototype.stopIndexing = function() {
  this.releaseEventFilter.stopWatching();
};

LocalCatalog.prototype.saveIndexState = function() {
  jsonio.saveObject(this.indexName, this.pppIndex);
};

LocalCatalog.prototype.loadIndexState = function() {
  return jsonio.loadObject(this.indexName)
    .bind(this)
    .then(function(result) {
      if (!result) {
        return {
          lastBlock: 0,
          contracts: {}
        };
      }
      else return result;
    })
};

LocalCatalog.prototype.updateLicense = function(licenseAddress, blockNumber) {
  return new Promise(function(resolve, reject) {
    var licenseContract = this.web3.eth.contract(this.licenseAbi).at(licenseAddress);
    var licenseObject = this.pppIndex.contracts[licenseAddress];
    if (!licenseObject) {
      // TODO: Stop using contract_id
      licenseObject = {address: licenseAddress, contract_id: licenseAddress};
      licenseObject.work = this.loadWorkFromAddress(licenseContract.workAddress());
      licenseObject.blockNumber = blockNumber;
      this.pppIndex.contracts[licenseAddress] = licenseObject;
    }
    this.updateFields(licenseObject, licenseContract, ['weiPerPlay', 'tipCount', 'totalEarned', 'owner', 'resourceUrl', 'metadataUrl']);
    resolve(licenseObject);
  }.bind(this))
};

LocalCatalog.prototype.loadWorkFromAddress = function(workAddress) {
  var workContract = this.web3.eth.contract(this.workAbi).at(workAddress);
  return this.updateFields({address: workAddress}, workContract, ['title', 'artist', 'imageUrl', 'metadataUrl']);
};

LocalCatalog.prototype.updateFields = function(output, contract, fields) {
  fields.forEach(function(f) {
    try {
      output[f] = contract[f]();
      if (output[f] && typeof(output[f]) === 'string' && output[f].startsWith("ipfs://")) {
        output[f + "_https"] = output[f].replace("ipfs://", "https://ipfs.io/ipfs/");
      }
    }
    catch(e) {
      console.log("Could not read field from contract: " + f + ", contract: " + contract.address);
    }

  });
  return output;
};

module.exports = LocalCatalog;
