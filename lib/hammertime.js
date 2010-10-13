#! /usr/bin/env node

var child_process = require('child_process'),
    http = require('http'),
    sys = require('sys'),
    url = require('url'),
    SocketIOClient = require('./hammertime/socketioclient'),
    BayeuxClient = require('./hammertime/bayeuxclient');

var connectInParallel = 8;

function add (acc, n) {
    return acc + n;
}

function max (a, b) {
    return a > b ? a : b;
}

function min (a, b) {
    return a < b ? a : b;
}

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
TimingStats.prototype.finished = function (id) {
    if (!this.started) return;
    this.started = false;
    sys.puts(JSON.stringify({
        //when: (new Date()).toString(),
        id: id,
        received: this.i,
        attempted: this.total,
        total: this.timings.reduce(add, 0),
        min: this.timings[0],
        max: this.timings[this.i - 1]
    }));
    this.i = 0;
    this.timings = new Array(this.total);
};

function connectSockets (total, stats, dataUrl, clientClass, onconnect) {
    var sockets = [],
        urlInfo = url.parse(dataUrl);

    var connectorCalled = 0;

    var connector = function (n) {
        connectorCalled++;
        var socket = new clientClass(urlInfo.hostname, urlInfo.port, urlInfo.pathname);
        socket.on('connect', function () {
            stats.ping();
            sockets.push(socket);
            if (n > 1) {
                setTimeout(function () {
                    connector(n - 1);
                }, 50);
            } else if (sockets.length === total) {
                onconnect(sockets);
            }
            socket.removeAllListeners('error');
            socket.removeAllListeners('connect');
        });

        socket.on('disconnect', function (e) {
            sys.error('got disconnect');
        });

        socket.on('error', function (e) {
            sys.error('error connecting socket: ' + e);
            socket.disconnect();
            setTimeout(function () {
                connector(n);
            }, 250);
        });
        socket.connect();
    };

    var connectionsPerConnector = Math.ceil(total / connectInParallel);

    for (var i = total; i > 0; i -= connectionsPerConnector) {
        connector(Math.min(connectionsPerConnector, i));
    }
}

function runTest(numClients, url, clientClass) {
    var connectStats = new TimingStats(numClients, 'Connected'),
        messageStats = {},
        timeouts = {},
        seen = {},
        clients = [];

    var stdin = process.openStdin();
    stdin.on('end', function () {
        sys.error('got end on stdin, exiting');
        process.exit(1);
    });
    stdin.on('error', function () {
        sys.error('got error on stdin, exiting');
        process.exit(1);
    });

    connectStats.begin();
    connectSockets(numClients, connectStats, url, clientClass, function (clients) {
        connectStats.finished('connect');

        var waitingFor = 0,
            eventsAdded = false;

        for (var i = 0; i < numClients; ++i) {
            clients[i].on('error', function (e) {
                sys.error('got error from client ' + e);
            });
            clients[i].on('message', function (data) {
                if (! eventsAdded) {
                    return;
                }
                var id = data.start.toString();
                if (! seen[id]) {
                    seen[id] = true;
                    timeouts[id] = setTimeout(function () {
                        waitingFor--;
                        messageStats[id].finished(id);
                        delete messageStats[id];
                        delete timeouts[id];
                    }, 15 * 1000);
                    waitingFor++;
                    messageStats[id] = new TimingStats(numClients, 'Received');
                    messageStats[id].begin(data.start);
                }
                if (id in timeouts) {
                    messageStats[id].ping();
                    if (messageStats[id].i >= numClients) {
                        waitingFor--;
                        messageStats[id].finished(id);
                        delete messageStats[id];
                        clearTimeout(timeouts[id]);
                        delete timeouts[id];
                        delete seen[id];
                    }
                }
                if (waitingFor > 5) {
                    throw new Error('unexpectedly waiting for more than five events');
                }
            });
        }
        eventsAdded = true;
    });
}

function runPoster(interval, postUrl, data) {
    var proxy = process.env['http_proxy'],
        postInfo,
        connectInfo,
        postPath,
        request,
        port;

    postInfo = url.parse(postUrl);
    connectInfo = proxy ? url.parse(proxy) : postInfo;
    postPath = proxy ? postUrl : postInfo.pathname;
    port = parseInt(connectInfo.port, 10);
    if (! port || isNaN(port)) {
        port = 80;
    }

    var poster = http.createClient(port, connectInfo.hostname);

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
                throw new Error('Server error: ' + response.statusCode);
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

function aggregateAverage (stats) {
    return stats.map(function (i) { return i.total; }).reduce(add) /
           stats.map(function (i) { return i.received; }).reduce(add);
}

function printConnectStats(stats, connected, total) {
    sys.puts('child connected (' + connected + '/' + total + '), min: ' + stats.min + ', max: ' + stats.max + ', avg: ' +  (stats.total / stats.received));
}

function printAggregateStats(stats) {
    var id = parseInt(stats[0].id, 10);
    var started = isNaN(id) ? stats[0].id : new Date(id);
    sys.puts(
        'min: ' + stats.map(function (i) { return i.min; }).reduce(min) + 'ms, ' +
        'max: ' + stats.map(function (i) { return i.max; }).reduce(max) + 'ms, ' +
        'avg: ' + aggregateAverage(stats) + 'ms, ' +
        'rvd: ' + stats.map(function (i) { return i.received; }).reduce(add) + '/' +
                  stats.map(function (i) { return i.attempted; }).reduce(add) +
        '    (' + started + ')'
    );
}

function runSpawnedTest (children, connections, url, clientClassName) {
    var stats = {},
        connectedChildren = 0;
    for (var i = 0; i < children; i++) {
        spawnChild(
            i, connections, url, clientClassName,
            function (stat) {
                printConnectStats(stat, ++connectedChildren, children);
            },
            function (stat) {
                if (! (stat.id in stats)) {
                    stats[stat.id] = [];
                }
                stats[stat.id].push(stat);
                if (stats[stat.id].length === connectedChildren) {
                    printAggregateStats(stats[stat.id]);
                    delete stats[stat.id];
                }
            }
        );
    }
}


function spawnChild (id, connections, url, clientClassName, onConnect, onStats) {
    var child = child_process.spawn(
        process.argv[0],
        [process.argv[1], '--run=' + connections, '--url=' + url, '--client-class=' + clientClassName]
    );
    var buffer = '';
    child.stdout.on("data", function (data) {
        buffer += data;
        for (;;) {
            var nl = buffer.indexOf('\n');
            if (nl === -1) {
                break;
            }
            var line = buffer.substr(0, nl);
            buffer = buffer.substr(nl + 1);
            var data = JSON.parse(line);
            if (data.id === 'connect') {
                onConnect(data);
            }
            else {
                onStats(data);
            }
        }
    });
    var error = '';
    child.stderr.on("data", function (data) {
        sys.error(data);
        error += data;
    });
    child.on("exit", function () {
    sys.error('child exited, output to stderr was:\n' + error);
        process.exit(1);
    });
    process.on("exit", function () {
        try {
            child.kill();
        } catch (e) {
        }
    });
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
        runSpawnedTest(spawnChildren, spawnConnections, url, clientClassName);
    }

    if (run) {
        runTest(run, url, clientClass);
    }

}
