/**
 *
 *      iobroker artnet-recorder Adapter
 *
 *      Copyright (c) 2021, Bannsaenger <bannsaenger@gmx.de>
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

        // prepare buffers for header comparison
        this.artNetHeader  = new Uint8Array([0x41, 0x72, 0x74, 0x2D, 0x4E, 0x65, 0x74, 0x00]);  // Art-Net0
        this.artNetOpcodecArtDMX = new Uint8Array([0x00, 0x50]);                                // 0x5000 little Endian (Opcode ArtDMX)
        this.artNetVersion = new Uint8Array([0x00, 0x0E]);                                      // Protocol Version 0 14
        // set some global variables
        this.recordRunning = false;                                                             // true if recording process is running
        this.recordStartTime = 0;                                                               // takes the time when recording has started
        this.playbackRunning = false;                                                           // true if a playback is in progress
        this.artNetBuffer = undefined;                                                          // filled later
        this.workingDir = '';                                                                   // filled with the working directory
        this.canRecord = true;                                                                  // false if working directory is not writable
        this.recFile = '';                                                                      // the file which is opened for recording
        this.recStartTime = undefined;                                                          // the time in msec when the record is started for calculating the offset in the record file
        this.nextPacketToSend = '';                                                             // the next packet to send in send mode
        this.nextPacketTime = undefined;                                                        // and the time to do this
        this.plyStartTime = undefined;                                                          // inluding the time offset to the start of the play mode
        this.plyLoop = false;                                                                   // play the file in a loop till playing is switched off ?
        this.plyFile = '';                                                                      // the file which is opened for playback
        this.mergeMode = 0;                                                                     // 0 = LTP, 1 = HTP
        this.liner = undefined;                                                                 // holds the lineByLine object
        this.tmrSendTimer = undefined;                                                          // holds the send timer for clear in unload

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

            let tmpObj = await self.getStateAsync('control.workingDir');
            // @ts-ignore
            self.workingDir = (tmpObj && tmpObj.val) ? tmpObj.val.toString() : '.';

            tmpObj = await self.getStateAsync('control.playbackLoop');
            // @ts-ignore
            self.plyLoop = (tmpObj && tmpObj.val) ? Boolean(tmpObj.val) : false;

            tmpObj = await self.getStateAsync('control.merge');
            // @ts-ignore
            self.mergeMode = (tmpObj && tmpObj.val) ? Number(tmpObj.val) : 0;

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

            // reset the mode on startup
            self.setState('control.mode', 0, true);

            // last thing to do is to start the onSendTimer
            self.tmrSendTimer = setInterval(self.onSendTimer.bind(self), self.config.packetDelay);

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
    async onServerMessage(msg, info) {
        const self = this;
        try {
            if (info.address === self.config.bind) return;         // packet from own address
            if (msg.length > 530) {
                self.log.debug(`Art-Net Recorder received packet with lenght > 530. Received length: ${msg.length}`);
                return;
            }
            const msg_hex = msg.toString('hex').toUpperCase();
            if (msg.slice(0, 8).compare(self.artNetHeader) != 0) {
                self.log.debug(`Art-Net Recorder received packet with unknown header. Received header: '${msg.slice(0, 8).toString('hex').toUpperCase()}'`);
                self.log.debug(`-> ${msg.length} bytes from ${info.address}:${info.port} : '${self.logHexData(msg_hex)}'`);
                return;
            }
            if (msg.slice(10, 12).compare(self.artNetVersion) != 0) {
                self.log.debug(`Art-Net Recorder received packet with unknown version. Received version: '${msg.slice(10, 12).toString('hex').toUpperCase()}'`);
                self.log.debug(`-> ${msg.length} bytes from ${info.address}:${info.port} : '${self.logHexData(msg_hex)}'`);
                return;
            }
            if (msg.slice(8, 10).compare(self.artNetOpcodecArtDMX) != 0) {
                self.log.debug(`Art-Net Recorder received packet with unknown opcode. Received opcode: '${msg.slice(8, 10).toString('hex').toUpperCase()}'`);
                self.log.debug(`-> ${msg.length} bytes from ${info.address}:${info.port} : '${self.logHexData(msg_hex)}'`);
                return;
            }
            const msgSequence = msg[12];
            const msgPhysical = msg[13];
            const msgNet = msg[15] & 0x7F;                      // delete the Bit 15
            const msgSubNet = (msg[14] & 0xF0) >> 4;
            const msgUniverse = msg[14] & 0x0F;
            const msgLength   = msg[16] * 256 + msg[17];
            if ((msgNet == self.config.net) && (msgSubNet == self.config.subNet) && (msgUniverse == self.config.universe)) {
                self.log.silly(`Art-Net Recorder received packet with ${msg.length} bytes from ${info.address}:${info.port} -> sequence: ${msgSequence}, physical: ${msgPhysical}, universe: '${msgNet}:${msgSubNet}:${msgUniverse} (${msgNet * 256 + msgSubNet * 16 + msgUniverse})', length: ${msgLength} DMX values`);
            } else {
                self.log.silly(`Art-Net Recorder received packet with ${msg.length} bytes from ${info.address}:${info.port} -> sequence: ${msgSequence}, physical: ${msgPhysical}, universe: '${msgNet}:${msgSubNet}:${msgUniverse} (${msgNet * 256 + msgSubNet * 16 + msgUniverse})', length: ${msgLength} DMX values. Universe or Net mismatch. Ignoring`);
                return;
            }
            const dmxVals = msg.slice(18, msg.length);
            if (!self.recordRunning) {          // no recording in progress. Only save the buffer and return
                self.artNetBuffer = dmxVals;
                return;
            }
            // from here there is playback or record running. Check whether it is dirty against the buffer
            const dmxValsChanged = [];
            let isDirty = false;

            for (let actBucket = 0; actBucket < dmxVals.length; actBucket++) {
                if (dmxVals[actBucket] != self.artNetBuffer[actBucket]) {
                    isDirty = true;
                    dmxValsChanged.push({'channel': actBucket + 1, 'value': dmxVals[actBucket]});
                }
            }
            if (isDirty) {
                const locNow = Date.now();
                if (self.recStartTime == undefined) {      // first record
                    self.recStartTime = locNow;
                }
                // eslint-disable-next-line no-unused-vars
                const locRecTime = locNow - self.recStartTime;
                //const locObj = {};
                const locStr = JSON.stringify({[locRecTime] : dmxValsChanged});
                fs.appendFile(self.recFile, `${locStr}\n`, (err) => {
                    if (err) throw err;
                    this.log.debug(`Art-Net Recorder append now to record file '${locStr}'`);
                });
            }
            self.artNetBuffer = dmxVals;        // remember the actual DMX value image

        } catch (err) {
            self.errorHandler(err, 'onServerMessage');
        }
    }

    /**
     * Is cyclic called by the send timer to lookup for new packets to send in sendmode
     */
    onSendTimer() {
        const self = this;
        let tmpStr, tmpObj;
        try {
            if (!self.playbackRunning) return;              // only action is while playback is running
            const locNow = Date.now() - self.plyStartTime;  // offset !
            if (self.nextPacketTime < locNow) {   // send packet and get next
                this.log.silly(`Art-Net Recorder send packet '${self.nextPacketTime}' on '${locNow}'`);
                // send packet
                self.sendPacket();
                // get next packet or end playback
                tmpStr = self.liner.next();
                if (tmpStr) {
                    tmpObj = JSON.parse(tmpStr);
                    self.nextPacketTime = Number(Object.keys(tmpObj)[0]);
                    self.nextPacketToSend = tmpObj[self.nextPacketTime];
                } else {
                    if (self.plyLoop) {
                        self.log.info(`Art-Net Recorder playback end, restart because of loop mode`);
                        self.plyStartTime = Date.now();
                        self.liner = new lineByLine(self.plyFile, {'readChunk': 15000, 'newLineCharacter': '\n'});
                        tmpStr = self.liner.next();
                        if (tmpStr) {
                            tmpObj = JSON.parse(tmpStr);
                            self.nextPacketTime = Number(Object.keys(tmpObj)[0]);
                            self.nextPacketToSend = tmpObj[self.nextPacketTime];
                            self.plyStartTime = Date.now();
                            self.playbackRunning = true;
                        } else {
                            self.log.error(`Art-Net Recorder error: File '${self.plyFile}' is now empty or corrupted. No playback possible`);
                            self.playbackRunning = false;
                            if (self.liner) self.liner.close();     // close playback file if open
                        }
                    } else {
                        self.log.info(`Art-Net Recorder ended playback`);
                        self.playbackRunning = false;
                        self.setState('control.mode', 0, true);
                    }
                }

            }
        } catch (err) {
            self.errorHandler(err, 'onSendTimer');
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        const self = this;
        let tmpObj;
        let tmpStr;
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
                                        if (self.liner) self.liner.close();     // close playback file if open
                                    } else {
                                        self.log.warn(`Art-Net Recorder can not record. No writable directory`);
                                        self.setState('control.mode', 0, true);
                                    }
                                    break;

                                case 2:             // Playback
                                    self.log.info(`Art-Net Recorder switched to Playback mode`);
                                    tmpObj = await self.getStateAsync('control.file');
                                    // @ts-ignore
                                    self.plyFile = `${self.workingDir}/${(tmpObj && tmpObj.val) ? tmpObj.val.toString() : ''}`;
                                    if (fs.existsSync(self.plyFile)) {
                                        self.liner = new lineByLine(self.plyFile, {'readChunk': 15000, 'newLineCharacter': '\n'});
                                        //self.liner.reset();             // when debugging there were sometimes strange effects
                                        tmpStr = self.liner.next();
                                        if (tmpStr) {
                                            tmpObj = JSON.parse(tmpStr);
                                            self.nextPacketTime = Number(Object.keys(tmpObj)[0]);
                                            self.nextPacketToSend = tmpObj[self.nextPacketTime];
                                            self.plyStartTime = Date.now();
                                            self.playbackRunning = true;
                                        } else {
                                            self.log.error(`Art-Net Recorder error: File '${self.plyFile}' is empty or corrupted. No playback possible`);
                                            self.playbackRunning = false;
                                            if (self.liner) self.liner.close();     // close playback file if open
                                        }
                                    } else {
                                        self.log.error(`Art-Net Recorder error: File '${self.plyFile}' does not exist. No playback possible`);
                                        self.playbackRunning = false;
                                        self.setState('control.mode', 0, true);
                                    }
                                    break;

                                default:
                                    self.log.info(`Art-Net Recorder switched off`);
                            }
                        }
                        if (/workingDir/.test(id)) {
                            self.log.info(`Art-Net Recorder changed working dir`);
                            self.workingDir = state.val ? state.val.toString() : '';
                        }
                        if (/playbackLoop/.test(id)) {
                            self.log.info(`Art-Net Recorder changed loop mode`);
                            self.plyLoop = state.val ? true : false;
                        }
                        if (/merge/.test(id)) {
                            self.log.info(`Art-Net Recorder changed merge mode`);
                            self.mergeMode = Number(state.val);
                        }
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
            const locDay = ('0' + locDateObj.getDate()).slice(-2);
            // current year
            const locYear = locDateObj.getFullYear();
            // current hours
            const locHours = ('0' + locDateObj.getHours()).slice(-2);
            // current minutes
            const locMinutes = ('0' + locDateObj.getMinutes()).slice(-2);
            // current seconds
            const locSeconds = ('0' + locDateObj.getSeconds()).slice(-2);
            // now create the filename
            const locFileName = `${locYear}${locMonth}${locDay}_${locHours}${locMinutes}${locSeconds}_Art-Net_Record.rec`;
            // file will be opened and appended on packet receiving
            self.recFile = `${self.workingDir}/${locFileName}`;
            self.recStartTime = undefined;          // reset for first recording
            self.log.error(`Art-Net Recorder create filename: '${locFileName}' for recording`);
        } catch (err) {
            self.errorHandler(err, 'createRecordFile');
        }
    }

    /**
     * Called for merging and sending a packet
	 */
    sendPacket() {
        const self = this;
        try {
            // merge nextPacketToSend to the dmx buffer depending on the merge mode
            for (const element of self.nextPacketToSend) {
                if (self.mergeMode) {           // if 0 (LTP) the provided values from the playback must be set
                    // @ts-ignore
                    self.artNetBuffer[element.channel - 1] = Number(element.value);
                } else {                        // HTP only set value if it is bigger than the bufferd value
                    // @ts-ignore
                    if (self.artNetBuffer[element.channel - 1] < Number(element.value)) {
                        // @ts-ignore
                        self.artNetBuffer[element.channel - 1] = Number(element.value);
                    }
                }
            }
            self.server.send(self.getArtNetPacket(), self.config.port, '255.255.255.255');
        } catch (err) {
            self.errorHandler(err, 'sendPacket');
        }
    }

    /**
     * Called for building a valid ArtDMX packet
     * @returns {Uint8Array}
	 */
    getArtNetPacket() {
        const self = this;
        let locBuffer = self.artNetHeader;
        try {
            locBuffer = Buffer.concat([locBuffer, new Uint8Array([0x00, 0x50])]);   // Opcode 0x5000 (ArtDMX)
            locBuffer = Buffer.concat([locBuffer, self.artNetVersion]);             // Version 14
            locBuffer = Buffer.concat([locBuffer, new Uint8Array([0x00, 0x00])]);   // Sequence and physical is 0 for now
            /*
            locBuffer = Buffer.concat([locBuffer, new Uint8Array([0x00, 0x00])]);   // Universe only 0 for now
            const statusByte = 0xE0 + Number(channelInBank)-1;
            const dataByte2 = Math.floor(Number(logObj.midiValue) / 128).toFixed(0);
            const dataByte1 = Math.floor(Number(logObj.midiValue) - (Number(dataByte2) * 128)).toFixed(0);
            const midiCommand = new Uint8Array([statusByte, Number(dataByte1), Number(dataByte2)]);
            */
            // Low Byte is Net, High Byte is Subnet and Universe (little endian !)
            const universeHiByte = (Number(self.config.subNet) << 4) | Number(self.config.universe);
            const lengthHiByte = Math.floor(Number(self.artNetBuffer.length) / 256).toFixed(0);
            const lengthLoByte = Math.floor(Number(self.artNetBuffer.length) - (Number(lengthHiByte) * 256)).toFixed(0);
            locBuffer = Buffer.concat([locBuffer, new Uint8Array([Number(universeHiByte), self.config.net, Number(lengthHiByte), Number(lengthLoByte)]), self.artNetBuffer]);
        } catch (err) {
            self.errorHandler(err, 'getArtNetPacket');
        }
        return(locBuffer);
    }

    /**
     * format the given hex string to a byte separated form
     * @param {string} locStr
     */
    logHexData(locStr) {
        let retStr = '';
        for (let i = 0; i < locStr.length; i += 2) {
            retStr += locStr.substr(i, 2) + ' ';
        }
        retStr = retStr.substr(0, retStr.length - 1);
        return retStr;
    }

    /**
     * Called on error situations and from catch blocks
	 * @param {any} err
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
            // reset the mode
            self.setState('control.mode', 0, true);

            // Here you must clear all timeouts or intervals that may still be active
            clearInterval(self.tmrSendTimer);

            // close playback file if open
            if (self.liner) self.liner.close();

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