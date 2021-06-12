/**
 *
 *      iobroker artnet-recorder Adapter
 *
 *      Copyright (c) 2020-2021, Bannsaenger <bannsaenger@gmx.de>
 *
 *      MIT License
 *
 */

/*
 * ToDo:
 *      -
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
const fs = require('fs');
const udp = require('dgram');
const lineByLine = require('n-readlines');
//const path = require('path');

class ArtnetRecorder extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'artnet-recorder',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        // this.on('objectChange', this.onObjectChange.bind(this));
        // this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));

        // read Objects template for object generation
        this.objectsTemplate = JSON.parse(fs.readFileSync(__dirname + '/lib/objects_templates.json', 'utf8'));

        // set some global variables
        this.recordRunning = false;                                                             // true if recording process is running
        this.recordStartTime = 0;                                                               // takes the time when recording has started
        this.playbackRunning = false;                                                           // true if a playback is in progress
        // prepare buffers for header comparison
        this.artNetHeader  = Buffer.from([0x41, 0x72, 0x74, 0x2D, 0x4E, 0x65, 0x74, 0x00]);     // Art-Net0
        this.artNetOpcode  = Buffer.from([0x00, 0x50]);                                         // 0x5000 little Endian
        this.artNetVersion = Buffer.from([0x00, 0x0E]);                                         // Protocol Version 0 14
        this.artNetBuffer = undefined;                                                          // filled later
        this.workingDir = '';                                                                   // filled with the working directory
        this.canRecord = true;                                                                  // false if working directory is not writable
        this.recFile = undefined;                                                               // the file which is opened for recording

        // creating a udp server
        this.server = udp.createSocket('udp4');
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        const self = this;
        try {
            // Initialize your adapter here
            // Reset the connection indicator during startup
            self.setState('info.connection', false, true);

            // emits when any error occurs
            self.server.on('error', self.onServerError.bind(self));

            // emits when socket is ready and listening for datagram msgs
            self.server.on('listening', self.onServerListening.bind(self));

            // emits after the socket is closed using socket.close();
            self.server.on('close', self.onServerClose.bind(self));

            // emits on new datagram msg
            self.server.on('message', self.onServerMessage.bind(self));

            // The adapters config (in the instance object everything under the attribute 'native' is accessible via
            // this.config:

            /*
            * For every state in the system there has to be also an object of type state
            */
            for (const element of self.objectsTemplate.common) {
                await self.setObjectNotExistsAsync(element._id, element);
            }
            for (const element of self.objectsTemplate.control) {
                await self.setObjectNotExistsAsync(`control.${element._id}`, element);
            }

            self.artNetBuffer = Buffer.alloc(Number(self.config.maxDmxAddress));    // create a internal buffer

            // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
            // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
            self.subscribeStates('*');

            // try to open open configured server port
            self.log.info('Bind UDP socket to: "' + self.config.bind + ':' + self.config.port + '"');
            self.server.bind(self.config.port, self.config.bind);

            // check if the given workingDirectory exists.
            // @ts-ignore
            const tempObj = await self.getStateAsync('control.workingDir');
            // @ts-ignore
            self.workingDir = (tempObj && tempObj.val) ? tempObj.val.toString() : '.';

            if (fs.existsSync(self.workingDir)) {
                const locWritable = await fs.accessSync(self.workingDir, fs.constants.R_OK | fs.constants.W_OK);
                if (locWritable == undefined) {
                    self.log.info(`Art-Net Recorder working directory: ${self.workingDir} exists and is writable.`);
                } else {
                    self.log.info(`Art-Net Recorder working directory: ${self.workingDir} exists but is not writable. Recording not possible.`);
                    self.canRecord = false;
                }
            } else {
                self.log.error(`Art-Net Recorder working directory: ${self.workingDir} did not exist. Terminating`);
                self.terminate();
            }

            const obj1 = new lineByLine(__dirname + '/lib/testbuckets.rec', {'readChunk': 15000, 'newLineCharacter': '\n'});
            const line1 = JSON.parse(obj1.next());
            const line2 = JSON.parse(obj1.next());
            const line3 = JSON.parse(obj1.next());
            //obj1.close();

            self.log.silly(`${line1}${line2}${line3}`);
            // reset the mode on startup
            self.setState('control.mode', 0, true);

            // Set the connection indicator after startup
            // self.setState('info.connection', true, true);
            // set by onServerListening

        } catch (err) {
            self.errorHandler(err, 'onReady');
        }
    }

    // Methods related to Server events
    /**
     * Is called if a server error occurs
     * @param {any} error
     */
    onServerError(error) {
        this.log.error('Art-Net Recorder server got Error: <' + error + '> closing server.');
        // Reset the connection indicator
        this.setState('info.connection', false, true);
        this.server.close();
    }

    /**
     * Is called when the server is ready to process traffic
     */
    onServerListening() {
        const self = this;
        try {
            const addr = self.server.address();
            self.log.info('Art-Net Recorder server ready on <' + addr.address + '> port <' + addr.port + '> proto <' + addr.family + '>');
            // maybe subject to change when switching to "real" Art-Net node
            self.server.setBroadcast(true);
            // Set the connection indicator after server goes for listening
            self.setState('info.connection', true, true);
        } catch (err) {
            self.errorHandler(err, 'onServerListening');
        }
    }

    /**
     * Is called when the server is closed via server.close
     */
    onServerClose() {
        this.log.info('Art-Net Recorder server is closed');
    }

    /**
     * Is called on new datagram msg from server
     * @param {Buffer} msg      the message content received by the server socket
     * @param {Object} info     the info for e.g. address of sending host
     */
    // eslint-disable-next-line no-unused-vars
    async onServerMessage(msg, info) {
        const self = this;
        try {
            if (msg.length < 20) {
                self.log.debug(`Art-Net Recorder received packet with lenght < 20. Received length: ${msg.length}`);
                return;
            }
            if (msg.length > 530) {
                self.log.debug(`Art-Net Recorder received packet with lenght > 530. Received length: ${msg.length}`);
                return;
            }
            if (msg.slice(0, 8).compare(self.artNetHeader) != 0) {
                self.log.debug(`Art-Net Recorder received packet with unknown header. Received header: ${msg.slice(0, 8).toString()}`);
                return;
            }
            if (msg.slice(8, 10).compare(self.artNetOpcode) != 0) {
                self.log.debug(`Art-Net Recorder received packet with unknown opcode. Received opcode: ${msg.slice(8, 10).toString()}`);
                return;
            }
            if (msg.slice(10, 12).compare(self.artNetVersion) != 0) {
                self.log.debug(`Art-Net Recorder received packet with unknown version. Received version: ${msg.slice(10, 12).toString()}`);
                return;
            }
            const msgSequence = msg[12];
            const msgPhysical = msg[13];
            const msgUniverse = msg[15] * 256 + msg[14];
            const msgLength   = msg[16] * 256 + msg[17];
            self.log.debug(`Art-Net Recorder received packet with sequence: ${msgSequence}, physical: ${msgPhysical}, universe: ${msgUniverse}, length: ${msgLength}`);
            if (!self.recordRunning) {          // no recording in progress. Only save the buffer and return
                self.artNetBuffer = msg.slice(18, msg.length);
                return;
            }
            // from here there is playback or record running. Check whether it is dirty against the buffer
            const dmxVals = msg.slice(18, msg.length);
            const dmxValsChanged = [];
            let isDirty = false;

            for (let actBucket = 0; actBucket < dmxVals.length; actBucket++) {
                if (dmxVals[actBucket] != self.artNetBuffer[actBucket]) {
                    isDirty = true;
                    dmxValsChanged.push({'channel': actBucket + 1, 'value': dmxVals[actBucket]});
                }
            }
            if (isDirty) {
                this.log.silly(JSON.stringify(dmxValsChanged));
            }
            self.artNetBuffer = dmxVals;

        } catch (err) {
            self.errorHandler(err, 'onServerMessage');
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        const self = this;
        try {
            if (state) {
                // The state was changed
                // self.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                if (!state.ack) {                   // only react on not acknowledged state changes
                    if (state.lc === state.ts) {    // last changed and last updated equal then the value has changed
                        self.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                        if (/mode/.test(id)) {
                            self.log.info(`Art-Net Recorder mode ${id} changed to ${state.val}`);
                            self.playbackRunning = false;
                            self.recordRunning = false;
                            switch (state.val) {
                                case 1:             // Record
                                    if (self.canRecord) {
                                        self.recordRunning = true;
                                        self.createRecordFile();
                                        self.log.info(`Art-Net Recorder switched to Record mode`);
                                    } else {
                                        self.log.warn(`Art-Net Recorder can not record. No writable directory`);
                                    }
                                    break;

                                case 2:             // Playback
                                    self.log.info(`Art-Net Recorder switched to Playback mode`);
                                    self.playbackRunning = true;
                                    if (self.recFile) {
                                        self.log.debug(`Art-Net Recorder closed recording file`);
                                        self.recFile.close();
                                    }
                                    break;

                                default:
                                    self.log.info(`Art-Net Recorder switched off`);
                            }
                        }
                    }
                    else {
                        self.log.debug(`state ${id} only updated not changed: ${state.val} (ack = ${state.ack})`);
                    }
                }
            } else {
                // The state was deleted
                self.log.info(`state ${id} deleted`);
            }
        } catch (err) {
            self.errorHandler(err, 'onStateChange');
        }
    }

    /**
     * Called for creating a new file for recording
	 */
    createRecordFile() {
        const self = this;
        try {
            const locDateObj = new Date();
            // current date
            // current month
            const locMonth = ('0' + (locDateObj.getMonth() + 1)).slice(-2);
            // current day
            const locDay = ('0' + (locDateObj.getDay() + 1)).slice(-2);
            // current year
            const locYear = locDateObj.getFullYear();
            // current hours
            const locHours = locDateObj.getHours();
            // current minutes
            const locMinutes = locDateObj.getMinutes();
            // current seconds
            const locSeconds = locDateObj.getSeconds();
            const locFileName = `${locYear}${locMonth}${locDay}_${locHours}${locMinutes}${locSeconds}_Art-Net_Record.rec`;
            // try to open the file
            self.recFile = fs.openSync(`${self.workingDir}/${locFileName}`, 'w');
            self.log.error(`Art-Net Recorder opened file:${locFileName} for recording`);
        } catch (err) {
            self.errorHandler(err, 'createRecordFile');
        }
    }

    /**
     * Called on error situations and from catch blocks
	 * @param {Error} err
	 * @param {string} module
	 */
    errorHandler(err, module = '') {
        this.log.error(`Art-Net Recorder error in method: [${module}] error: ${err.message}, stack: ${err.stack}`);
    }

    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.message" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    // onMessage(obj) {
    //     if (typeof obj === 'object' && obj.message) {
    //         if (obj.command === 'send') {
    //             // e.g. send email or pushover or whatever
    //             this.log.info('send command');

    //             // Send response in callback if required
    //             if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
    //         }
    //     }
    // }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(callback) {
        try {
            const self = this;
            // Reset the connection indicator
            self.setState('info.connection', false, true);

            // Here you must clear all timeouts or intervals that may still be active

            // close the recording file
            if (self.recFile) {
                self.log.warn(`Art-Net Recorder closed recording file on unload`);
                self.recFile.close();
            }

            // close the server port
            this.server.close(callback);
        } catch (e) {
            callback();
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => {'use strict';new ArtnetRecorder(options); };
} else {
    // otherwise start the instance directly
    new ArtnetRecorder();
}