'use strict';

// Load modules

const Code = require('code');
const Consul = require('consul');
const Hapi = require('hapi');
const HapiConsul = require('..');
const Hoek = require('hoek');
const Lab = require('lab');


// Declare internals

const internals = {
    consul: Consul({ promisify: true })
};


// Test shortcuts

const { describe, it } = exports.lab = Lab.script();
const { expect } = Code;


describe('plugin', () => {

    it('registers on start', async () => {

        const server = Hapi.Server();

        await server.register(HapiConsul);

        const list1 = await internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        });

        await server.start();

        const list2 = await internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        });

        await server.stop();

        expect(list1).to.have.length(0);
        expect(list2).to.have.length(1);
    });

    it('registers tags', async () => {

        const server = Hapi.Server({ plugins: { attache: { tags: ['b', 'c', 'a'] } }, host: 'localhost' });

        await server.register(HapiConsul);

        const list1 = await internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        });

        await server.start();

        const list2 = await internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        });

        await server.stop();

        expect(list1).to.have.length(0);
        expect(list2).to.have.length(1);
        expect(list2[0].ServiceTags).to.exist();
        expect(list2[0].ServiceTags).to.only.once.include(['a', 'b', 'c']);
    });

    it('supports custom hostnames', async () => {

        const server = Hapi.Server({ host: 'localhost' });

        await server.register(HapiConsul);

        const list1 = await internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        });

        await server.start();

        const list2 = await internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        });

        await server.stop();

        expect(list1).to.have.length(0);
        expect(list2).to.have.length(1);
        expect(list2[0]).to.include({ ServiceAddress: '127.0.0.1' });
    });

    it('starts in a healthy state', async () => {

        const server = Hapi.Server();

        await server.register(HapiConsul);

        await server.start();

        const map = await internals.consul.agent.check.list();

        const checkId = 'service:' + server.consul.connectionId;

        await server.stop();

        expect(map).to.include(checkId);
        expect(map[checkId]).to.include({
            Status: 'passing'
        });
    });

    it('start() returns error on missing consul api access', async () => {

        const server = Hapi.Server();

        await server.register({
            plugin: HapiConsul,
            options: {
                consul: {
                    host: 'does.not.exist'
                }
            }
        });

        const err = await expect(server.start()).to.reject();
        expect(err.code).to.equal('ENOTFOUND');

        await server.stop();
    });

    it('start() works on missing consul api access in lowProfile mode', async () => {

        const server = Hapi.Server();

        await server.register({
            plugin: HapiConsul,
            options: {
                consul: {
                    host: 'does.not.exist'
                },
                lowProfile: true
            }
        });

        await server.start();

        const list = await internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        });

        await server.stop();

        expect(list).to.have.length(0);
    });

    it('supports the retryStrategy option', async () => {

        const server = Hapi.Server();

        let timer;
        let elapsed = 0;
        let started = false;

        const retryStrategy = (consul, error, details) => {

            if (details.action === 'register') {
                if (details.attempt === 1) {
                    timer = new Hoek.Bench();
                    return 50;
                }

                if (details.attempt === 2 && started) {
                    elapsed = timer.elapsed();
                    consul.api._opts.baseUrl.port = 8500;
                    return 0;
                }
            }
        };

        await server.register({
            plugin: HapiConsul,
            options: {
                consul: {
                    port: 8501
                },
                lowProfile: true,
                retryStrategy
            }
        });

        await server.start();

        started = true;

        await Hoek.wait(80);

        const list = await internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        });

        await server.stop();

        expect(elapsed).to.be.at.least(50);
        expect(list).to.have.length(1);
    });

    it('throws on invalid registration options', async () => {

        const server = Hapi.Server();

        await expect(server.register({
            plugin: HapiConsul,
            options: {
                service: {
                    name: false
                }
            }
        })).to.reject(/^Invalid plugin options/);
    });

    it('throws on invalid server plugin options', async () => {

        const server = Hapi.Server({ plugins: { attache: { unknown: true } } });

        await expect(server.register(HapiConsul)).to.reject(/^Invalid server options/);
    });

    it('supports manual maintenance mode', async () => {

        const serviceName = '+hapitest:maint';
        const config = { plugins: { attache: { id: serviceName } } };
        const server = Hapi.Server(config);

        await server.register({
            plugin: HapiConsul,
            options: {
                service: {
                    name: serviceName
                }
            }
        });

        await server.start();

        await server.consul.maintenance('Emergency!');

        const status1 = await server.consul.maintenance();

        expect(status1).to.include({
            Status: 'critical',
            Notes: 'Emergency!'
        });

        await server.consul.maintenance(false);

        const status2 = await server.consul.maintenance();

        await server.stop();

        expect(status2).to.equal(false);
    });

    it('performs http health check', async () => {

        const server = Hapi.Server({ host: '127.0.0.1', plugins: { attache: { id: '+hapitest:health' } } });

        await server.register({
            plugin: HapiConsul,
            options: {
                service: {
                    check: {
                        interval: 1000,
                        startHealthy: false,
                        deregisterAfter: false
                    }
                }
            }
        });

        server.route({
            method: 'GET',
            path: '/_health',
            handler() {

                return 'OK';
            }
        });

        await server.start();

        const result1 = await internals.consul.agent.check.list();

        await Hoek.wait(1200);

        const result2 = await internals.consul.agent.check.list();

        await server.stop();

        expect(result1).to.include('service:+hapitest:health');
        expect(result1['service:+hapitest:health']).to.include({
            Status: 'critical'
        });
        expect(result2).to.include('service:+hapitest:health');
        expect(result2['service:+hapitest:health']).to.include({
            Status: 'passing',
            Output: 'HTTP GET ' + server.info.uri + '/_health: 200 OK Output: OK'
        });
    });

    it('supports ttl check-in', async () => {

        const server = Hapi.Server({ plugins: { attache: { id: '+hapitest:health2' } } });

        await server.register({
            plugin: HapiConsul,
            options: {
                service: {
                    check: {
                        ttl: '2s'
                    }
                }
            }
        });

        await server.start();

        const result1 = await internals.consul.agent.check.list();

        await server.consul.checkin(undefined, 'huh?');

        const result2 = await internals.consul.agent.check.list();

        await server.consul.checkin(false, 'bonkers…');

        const result3 = await internals.consul.agent.check.list();

        await server.stop();

        expect(result1).to.include('service:+hapitest:health2:2');
        expect(result1['service:+hapitest:health2:2']).to.include({
            Status: 'passing'
        });
        expect(result2).to.include('service:+hapitest:health2:2');
        expect(result2['service:+hapitest:health2:2']).to.include({
            Status: 'warning',
            Output: 'huh?'
        });
        expect(result3).to.include('service:+hapitest:health2:2');
        expect(result3['service:+hapitest:health2:2']).to.include({
            Status: 'critical',
            Output: 'bonkers…'
        });
    });

    it('supports ttl check-in with disabled http check', async () => {

        const server = Hapi.Server({ plugins: { attache: { id: '+hapitest:health3' } } });

        await server.register({
            plugin: HapiConsul,
            options: {
                service: {
                    check: {
                        path: false,
                        ttl: '2s',
                        startHealthy: false
                    }
                }
            }
        });

        await server.start();

        const result1 = await internals.consul.agent.check.list();

        await server.consul.checkin(true);

        const result2 = await internals.consul.agent.check.list();

        await server.stop();

        expect(result1).to.include('service:+hapitest:health3');
        expect(result1['service:+hapitest:health3']).to.include({
            Status: 'critical'
        });
        expect(result2).to.include('service:+hapitest:health3');
        expect(result2['service:+hapitest:health3']).to.include({
            Status: 'passing',
            Output: ''
        });
    });

    it('reports check-in errors', async () => {

        const server = Hapi.Server({ plugins: { attache: { id: '+hapitest:health4' } } });

        await server.register({
            plugin: HapiConsul,
            options: {
                service: {
                    check: {
                        path: false,
                        ttl: '2s'
                    }
                }
            }
        });

        await expect(server.consul.checkin(true)).to.reject();
    });

    it('handles disabled check.path option', async () => {

        const server = Hapi.Server({ plugins: { attache: { id: '+hapitest' } } });

        await server.register({
            plugin: HapiConsul,
            options: {
                service: {
                    check: {
                        path: false
                    }
                }
            }
        });

        await server.start();

        const result = internals.consul.agent.check.list();

        await server.stop();

        expect(result).to.not.include('service:+hapitest');
    });

    it('forwards maintenance() backend errors', async () => {

        const server = Hapi.Server({ plugins: { attache: { id: '+hapitest:deregisterfail' } } });

        await server.register(HapiConsul);

        await server.start();

        const saved1 = server.consul.api.agent.check.list;
        server.consul.api.agent.check.list = () => {

            server.consul.api.agent.check.list = saved1;
            throw new Error('failed');
        };

        await expect(server.consul.maintenance()).to.reject();

        const saved2 = server.consul.api.agent.service.maintenance;
        server.consul.api.agent.service.maintenance = (opts) => {

            server.consul.api.agent.service.maintenance = saved2;
            throw new Error('failed');
        };

        await expect(server.consul.maintenance(false)).to.reject();

        await server.stop();
    });

    it('reaps critical services', { timeout: 2 * 60 * 1000, parallel: true }, async () => {

        const server = Hapi.Server({ plugins: { attache: { id: '+hapitest:reaper' } }, host: 'localhost' });

        await server.register({
            plugin: HapiConsul,
            options: {
                service: {
                    check: {
                        ttl: '20s',
                        startHealthy: false,
                        deregisterAfter: '1s'
                    }
                }
            }
        });

        await server.start();

        server.listener.close();

        const checkLater = async () => {

            await Hoek.wait(1000);

            const result = await internals.consul.agent.service.list();

            if (result['+hapitest:reaper']) {
                return checkLater();
            }
        };

        await checkLater();

        await server.stop();
    });

    it('doesn\'t register on initialize', async () => {

        const server = Hapi.Server();
        await server.register(HapiConsul);
        await server.initialize();

        const list1 = await internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        });

        await server.stop();

        const list2 = await internals.consul.catalog.service.nodes({
            service: 'hapi',
            consistent: true
        });

        expect(list1.length).to.equal(0);
        expect(list2.length).to.equal(0);
    });
});
