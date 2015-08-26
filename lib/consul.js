// Load modules

var Consul = require('consul');
var Hoek = require('hoek');
var Items = require('items');
var Joi = require('joi');


// Declare internals

var internals = {};


internals.schema = Joi.object({
    attache: Joi.object({
        id: Joi.string().description('Consul service id')
    })
}).unknown().allow(undefined);


exports.Consul = module.exports = function (server, serviceConfig, consulOptions) {

    for (var idx = 0; idx < server.connections.length; idx++) {
        var connection = server.connections[idx];
        Joi.assert(connection.settings.plugins, internals.schema, 'Invalid plugin connection options');
    }

    this.server = server;
    this.service = Hoek.clone(serviceConfig);
    this.api = new Consul(consulOptions);

    if (typeof this.service.check.interval === 'number') {
        this.service.check.interval = this.service.check.interval + 'ms';
    }
};


exports.Consul.prototype.register = function (next) {

    var self = this, server = self.server;

    server.log(['attache', 'consul', 'register'], 'Registering service: ' + self.service.name);

    return Items.parallel(server.connections, function (connection, nextItem) {

        var serviceInfo = {
            name: self.service.name,
            id: self.connectionId(connection),
            tags: connection.settings.labels,
            address: connection.info.address,
            port: connection.info.port
        };

        if (self.service.check.path) {
            serviceInfo.check = {
                http: connection.info.uri + self.service.check.path,
                interval: self.service.check.interval
            };
        }

        self.api.agent.service.register(serviceInfo, function (err) {

            if (err) {
                server.log(['attache', 'consul', 'error'], err);
                return nextItem(err);
            }

            nextItem();
        });
    }, next);
};


exports.Consul.prototype.deregister = function (next) {

    var self = this, server = self.server;

    server.log(['attache', 'consul', 'deregister'], 'Deregistering service: ' + self.service.name);

    return Items.parallel(server.connections, function (connection, nextItem) {

        var serviceInfo = {
            id: self.connectionId(connection)
        };

        self.api.agent.service.deregister(serviceInfo, function (err) {

            if (err) {
                server.log(['attache', 'consul', 'error'], err);
                return nextItem(err);
            }

            nextItem();
        });
    }, next);
};


exports.Consul.prototype.maintenance = function (reason, next) {

    var self = this, server = self.server;

    var check = false;
    if (typeof reason === 'function') {
        check = true;
        next = reason;
    }

    if (check) {
        return self.api.agent.check.list(function (err, result) {

            if (err) {
                return next(err);
            }

            var status = server.connections.map(function (connection) {

                return result['_service_maintenance:' + self.connectionId(connection)] || false;
            });

            return next(null, status);
        });
    }

    if (reason) {
        server.log(['attache', 'consul', 'maintenance', 'enter'], 'Trying to enter maintenance mode for ' + self.service.name + ', reason: ' + reason);
    } else {
        server.log(['attache', 'consul', 'maintenance', 'exit'], 'Trying to exit maintenance mode for ' + self.service.name);
    }

    return Items.parallel(server.connections, function (connection, nextItem) {

        var serviceInfo = {
            id: self.connectionId(connection),
            enable: !!reason,
            reason: reason
        };

        self.api.agent.service.maintenance(serviceInfo, function (err) {

            if (err) {
                server.log(['attache', 'consul', 'error'], err);
                return nextItem(err);
            }

            nextItem();
        });
    }, next);
};


exports.Consul.prototype.connectionId = function (connection) {

    return Hoek.reach(connection, 'settings.plugins.attache.id') ||
           (this.service.name + ':' + connection.info.port + ':' + process.pid);
};
