var sys = require('sys'),
    http = require('http'),
    url = require('url'),
    Client = require('./client');

var BayeuxClient = module.exports = function (host, port, path) {
    var self = this;
    Client.call(this);
    this.host = host;
    this.port = port || 80;
    this.path = path || '/';
    this.id = 0;
    this.cookie = null;
    this.clientId = null;
    this.channels = ['/testchannel'];
};
sys.inherits(BayeuxClient, Client);

BayeuxClient.prototype.connect = function () {
    this.sendHandshake();
};

// TODO: should this be a no-op?s

BayeuxClient.prototype.disconnect = function () {
    // no-op
};

BayeuxClient.prototype.sendHandshake = function () {
    var self = this;
    var request = this.sendPOST([
        {
            version: '1.0',
            minimumVersion: '0.9',
            channel: '/meta/handshake',
            id: '' + this.id++,
            /*ext: {'json-comment-filtered': true},*/
            supportedConnectionTypes: ['long-polling', 'callback-polling']
        }
    ]);
    request.on('response', function (response) {
        if (response.statusCode !== 200) {
            self.emit('error', response.statusCode);
            return;
        }
        var data = '',
            cookie;
        response.setEncoding('utf-8');
        cookie = response.headers['set-cookie'];
        if (cookie) {
            self.cookie = cookie.substring(0, cookie.indexOf(';'));
        }
        response.on('data', function (chunk) {
            data += chunk;
        });
        response.on('end', function () {
            self.clientId = JSON.parse(data)[0].clientId;
            self.sendConnect();
        });
    });
    request.end();
};

BayeuxClient.prototype.sendConnect = function () {
    var self = this;
    var request = this.sendPOST([
        {
            channel: '/meta/connect',
            clientId: this.clientId,
            connectionType: 'long-polling',
            id: '' + this.id++
        }
    ], this.cookie);
    request.on('response', function (response) {
	if (response.statusCode !== 200) {
	    self.emit('error', response.statusCode);
	    return;
	}
        var data = '';
        response.setEncoding('utf-8');
        response.on('data', function (chunk) {
            data += chunk;
        });
        response.on('end', function () {
            //sys.debug(sys.inspect(data));
            self.sendSubscribe();
        });
    });
    request.end();
};

BayeuxClient.prototype.sendSubscribe = function () {
    var self = this;
    var message = [];
    this.channels.forEach(function (c) {
        message.push({
            channel: '/meta/subscribe',
            subscription: c,
            clientId: self.clientId,
            id: self.id++
        });
    });
    var request = this.sendPOST(message, this.cookie);
    request.on('response', function (response) {
	if (response.statusCode !== 200) {
	    self.emit('error', response.statusCode);
	    return;
	}
        var data = '';
        response.setEncoding('utf-8');
        response.on('data', function (chunk) {
            data += chunk;
        });
        response.on('end', function () {
            //sys.debug(sys.inspect(data));
            self.emit('connect');
            self.sendPoll();
        });
    });
};

BayeuxClient.prototype.sendPoll = function () {
    var self = this;
    var request = this.sendPOST([
        {
            channel: '/meta/connect',
            connectionType: 'long-polling',
            clientId: this.clientId,
            id: '' + this.id++
        }
    ], this.cookie);
    request.on('response', function (response) {
	if (response.statusCode !== 200) {
	    self.emit('error', response.statusCode);
	    return;
	}
        var data = '';
        response.setEncoding('utf-8');
        response.on('data', function (chunk) {
            data += chunk;
        });
        response.on('end', function () {
            //sys.debug(sys.inspect(data));
            //callback(JSON.parse(data));
            var message;
            try {
                message = JSON.parse(data);
            }
            catch (e) {
                throw new Error('error decoding JSON: ' + data);
            }
            if (message.length === 2) {
                self.emit('message', JSON.parse(message[0].data));
            }
            self.sendPoll();
        });
    });
};

BayeuxClient.prototype.sendPOST = function (data) {
    var client,
        request,
        requestHost = this.host + ((this.port === 80) ? '' : ':' + this.port),
        proxy = process.env['http_proxy'];
    if (proxy) {
        var proxyUrl = url.parse(process.env['http_proxy']);
        client = http.createClient(parseInt(proxyUrl.port, 10), proxyUrl.hostname);
    }
    else {
        client = http.createClient(this.port, this.host);
    }
    var message = 'message=' + encodeURIComponent(JSON.stringify(data));
    var headers = {
        'Host': requestHost,
        'User-Agent': 'NodeJS HTTP Client',
        'Content-Length': message.length,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
    };

    if (this.cookie) {
        headers['Cookie'] = this.cookie;
    }
    if (proxy) {
        request = client.request('POST', 'http://' + requestHost + this.path, headers);
    }
    else {
        request = client.request('POST', this.path, headers);
    }
    request.write(message);
    return request;
}


