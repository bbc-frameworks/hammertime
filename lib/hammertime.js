#! /usr/bin/env node

var child_process = require('child_process'),
    http = require('http'),
    sys = require('sys'),
    url = require('url'),
    SocketIOClient = require('./hammertime/socketioclient'),
    BayeuxClient = require('./hammertime/bayeuxclient');

function TimingStats (total, label) {
    this.total = total;
    this.label = label;
    this.started = false;
    this.i = 0;
}
TimingStats.prototype.begin = function (timestamp) {
    if (!timestamp) {
        var d = new Date();
        timestamp = d.getTime();
    }
    this.start = timestamp;
    this.timings = new Array(this.total);
    this.started = true;
};
TimingStats.prototype.ping = function () {
    var d = new Date();
    this.timings[this.i++] = d.getTime() - this.start;
};
TimingStats.prototype.finished = function () {
    if (!this.started) return;
    this.started = false;
    var add = function (acc, n) { return acc + n; };
    sys.log(this.label + ' ' + this.i + '/' + this.total);
    sys.log(
        'avg: ' + (this.timings.reduce(add, 0) / this.i) + 'ms   ' +
        'min: ' + this.timings[0] + 'ms   max: ' + this.timings[this.i - 1] + 'ms'
    );
    this.i = 0;
    this.timings = new Array(this.total);
};

function connectSockets (total, stats, dataUrl, clientClass, onconnect) {
    var sockets = [],
        step = Math.ceil(total / 8),
        urlInfo = url.parse(dataUrl);

    var connector = function (n) {
        var socket = new clientClass(urlInfo.host, urlInfo.port, urlInfo.pathname);
        socket.on('connect', function () {
            stats.ping();
            sockets.push(socket);
            if (n > 1) {
                connector(n - 1);
            } else if (sockets.length === total) {
                onconnect(sockets);
            }
        });
        socket.on('error', function (e) {
            sys.debug('error connecting socket: ' + e);
            setTimeout(function () {
                connector(n);
            }, 250);
        });
        socket.connect();
    };

    for (var i = total; i > 0; i -= step) {
        connector(Math.min(step, i));
    }
}

function runTest(numClients, url, clientClass) {
    var connectStats = new TimingStats(numClients, 'Connected'),
        messageStats = new TimingStats(numClients, 'Received'),
        clients = [];

    connectStats.begin();
    connectSockets(numClients, connectStats, url, clientClass, function (clients) {
        connectStats.finished();

        var last_start = -1,
            seen = 0;
        for (var i = 0; i < numClients; ++i) {
            clients[i].on('message', function (data) {
                /*data = JSON.parse(data);*/
                if (data.start !== last_start) {
                    sys.debug('new timestamp: ' + data.start);
                    messageStats.finished();
                    messageStats.begin(data.start);
                    last_start = data.start;
                    seen = 0;
                }
                messageStats.ping();
                seen += 1;
                if (seen >= numClients) {
                    messageStats.finished();
                }
            });
        }
    });
}

function runPoster(interval, postUrl, data) {
    var proxy = process.env['http_proxy'],
        postInfo,
        connectInfo,
        poster,
        postPath,
        request;

    postInfo = url.parse(postUrl);
    connectInfo = proxy ? url.parse(proxy) : postInfo;
    poster = http.createClient(
        parseInt(connectInfo.port, 10),
        connectInfo.hostname
    );
    postPath = proxy ? postUrl : postUrl.pathname;

    setInterval(function () {
        data.start = (new Date()).getTime();
        var postData = JSON.stringify(data);
        request = poster.request('POST', postPath, {
            'Host': postInfo.hostname,
            'User-Agent': 'NodeJS',
            'Content-Type': 'application/json',
            'Content-Length': postData.length
        });
        request.write(postData);
        request.on('response', function (response) {
            if (response.statusCode !== 200) {
                throw new Error('Server error: ' + sys.inspect(response));
            }
            var received = '';
            response.on('data', function (chunk) {
                received += chunk;
            });
            response.on('end', function () {
            });
        });
        request.end();
    }, interval * 1000);
}

function spawnChild (id, connections, url, clientClassName) {
    var child = child_process.spawn(
        process.argv[0],
        [process.argv[1], '--run=' + connections, '--url=' + url, '--client-class=' + clientClassName]
    );
    child.stdout.on("data", function (data) {
        sys.puts("--> from child " + id);
        sys.print(data);
    });
    process.on("exit", function () { child.kill() });
    return child;
}

function printUsage () {
    sys.puts("usage: hammertime [ --post=INTERVAL,URL ] [ --spawn=CHILDREN,CONNECTIONS_PER_CHILD ] [ --run=CONNECTIONS ] [ --url=DATA_URL ] [ --client-class=socket.io|bayeaux ] ");
}

exports.run = function () {
    var post,
        postUrl,
        spawnChildren,
        spawnConnections,
        run,
        match,
        url,
        clientClass = SocketIOClient,
        clientClassName = 'socket.io',
        args = process.argv.slice(2);

    for (var i = 0, l = args.length; i < l; i++) {
        if (match = args[i].match(/^--post=(\d+),(.+)$/)) {
            post = parseInt(match[1], 10);
            postUrl = match[2];
        }
        else if (match = args[i].match(/^--spawn=(\d+),(\d+)$/)) {
            spawnChildren = parseInt(match[1], 10);
            spawnConnections = parseInt(match[2], 10);
        }
        else if (match = args[i].match(/^--run=(\d+)$/)) {
            run = parseInt(match[1], 10)
        }
        else if (match = args[i].match(/^--run=(\d+)$/)) {
            run = parseInt(match[1], 10)
        }
        else if (match = args[i].match(/^--url=(\S+)$/)) {
            url = match[1];
        }
        else if (match = args[i].match(/^--client-class=(socket.io|bayeux)$/)) {
            clientClassName = match[1];
            if (match[1] === 'bayeux') {
                clientClass = BayeuxClient;
            }
            // socket.io is the default
        }
        else {
            sys.puts("hammertime: unrecognised option " + args[i]);
            process.exit(1);
        }
    }

    if (! (post || (url && (spawnChildren || run)))) {
        printUsage();
        process.exit(1);
    }

    var data = {
        "testdata":"tttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt",
        "content": {'message': {'type': 'hammertime'}}
    };

    if (post) {
        runPoster(post, postUrl, data);
    }

    if (spawnChildren) {
        for (var i = 0; i < spawnChildren; i++) {
            spawnChild(i, spawnConnections, url, clientClassName);
        }
    }

    if (run) {
        runTest(run, url, clientClass);
    }

}
