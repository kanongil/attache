'use strict';

// Load modules

const Consul = require('consul');
const Hoek = require('hoek');
const Items = require('items');
const Joi = require('joi');


// Declare internals

const internals = {};


internals.schema = Joi.object({
    attache: Joi.object({
        id: Joi.string().description('Consul service id')
    })
}).unknown();


internals.durationParse = function (duration) {

    return (typeof duration === 'number') ? duration + 'ms' : duration;
};


exports.Consul = module.exports = function (server, serviceConfig, consulOptions) {

    for (let i = 0; i < server.connections.length; ++i) {
        const connection = server.connections[i];
        Joi.assert(connection.settings.plugins, internals.schema, 'Invalid plugin connection options');
    }

    this.server = server;
    this.service = Hoek.clone(serviceConfig);
    this.api = new Consul(consulOptions);

    this.service.check.interval = internals.durationParse(this.service.check.interval);
    this.service.check.ttl = internals.durationParse(this.service.check.ttl);
};


exports.Consul.prototype.register = function (next) {

    const server = this.server;

    server.log(['attache', 'consul', 'register'], `Registering service: ${this.service.name}`);

    return Items.parallel(server.connections, (connection, nextItem) => {

        const serviceInfo = {
            name: this.service.name,
            id: this.connectionId(connection),
            tags: connection.settings.labels,
            address: connection.info.address !== '0.0.0.0' ? connection.info.address : undefined,
            port: connection.info.port,
            checks: []
        };

        const initialState = this.service.check.startHealthy ? 'passing' : undefined;

        if (this.service.check.path) {
            serviceInfo.checks.push({
                http: connection.info.uri + this.service.check.path,
                interval: this.service.check.interval,
                status: initialState
            });
        }

        if (this.service.check.ttl) {
            serviceInfo.checks.push({
                ttl: this.service.check.ttl,
                status: initialState
            });
        }

        this.api.agent.service.register(serviceInfo, (err) => {

            if (err) {
                server.log(['attache', 'consul', 'error'], err);
                return nextItem(err);
            }

            nextItem();
        });
    }, next);
};


exports.Consul.prototype.deregister = function (next) {

    const server = this.server;

    server.log(['attache', 'consul', 'deregister'], `Deregistering service: ${this.service.name}`);

    return Items.parallel(server.connections, (connection, nextItem) => {

        const serviceInfo = {
            id: this.connectionId(connection)
        };

        this.api.agent.service.deregister(serviceInfo, (err) => {

            if (err) {
                server.log(['attache', 'consul', 'error'], err);
                return nextItem(err);
            }

            nextItem();
        });
    }, next);
};


exports.Consul.prototype.maintenance = function (reason, next) {

    const server = this.server;

    let check = false;
    if (typeof reason === 'function') {
        check = true;
        next = reason;
    }

    if (check) {
        return this.api.agent.check.list((err, result) => {

            if (err) {
                return next(err);
            }

            const status = server.connections.map((connection) => {

                return result['_service_maintenance:' + this.connectionId(connection)] || false;
            });

            return next(null, status);
        });
    }

    if (reason) {
        server.log(['attache', 'consul', 'maintenance', 'enter'], `Trying to enter maintenance mode for ${this.service.name}, reason: ${reason}`);
    }
    else {
        server.log(['attache', 'consul', 'maintenance', 'exit'], `Trying to exit maintenance mode for ${this.service.name}`);
    }

    return Items.parallel(server.connections, (connection, nextItem) => {

        const serviceInfo = {
            id: this.connectionId(connection),
            enable: !!reason,
            reason: reason
        };

        this.api.agent.service.maintenance(serviceInfo, (err) => {

            if (err) {
                server.log(['attache', 'consul', 'error'], err);
                return nextItem(err);
            }

            nextItem();
        });
    }, next);
};


exports.Consul.prototype.checkin = function (ok, note, callback) {

    const server = this.server;

    if (typeof note === 'function') {
        callback = note;
        note = null;
    }

    callback = callback || Hoek.ignore;

    const method = ok === true ? 'pass' : ok === false ? 'fail' : 'warn';
    const checkInstance = this.service.check.path ? ':2' : '';

    server.log(['attache', 'consul', 'checkin'], `Performing check-in with state: ${ok}`);

    return Items.parallel(server.connections, (connection, nextItem) => {

        this.api.agent.check[method]({
            id: 'service:' + this.connectionId(connection) + checkInstance,
            note: note || undefined
        }, (err) => {

            if (err) {
                server.log(['attache', 'consul', 'checkin', 'error'], err);
                return nextItem(err);
            }

            nextItem();
        });
    }, callback);
};


exports.Consul.prototype.connectionId = function (connection) {

    return Hoek.reach(connection, 'settings.plugins.attache.id') ||
           (this.service.name + ':' + connection.info.port + ':' + process.pid);
};
