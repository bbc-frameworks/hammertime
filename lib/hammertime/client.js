var sys = require('sys');

var Client = module.exports = function () {
    process.EventEmitter.call(this);
};

sys.inherits(Client, process.EventEmitter);
