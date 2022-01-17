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
// @ts-ignore
const lineByLine = require('n-readlines');
const { TIMEOUT } = require('dns');
//const { setTimeout } = require('timers');
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
        this.artNetBuffer = new Uint8Array();                                                   // filled later
        this.workingDir = '';                                                                   // filled with the working directory
        this.canRecord = true;                                                                  // false if working directory is not writable
        this.recFile = '';                                                                      // the file which is opened for recording
        this.recStartTime = 0;                                                                  // the time in msec when the record is started for calculating the offset in the record file
        this.nextPacketToSend = [];                                                             // the next packet to send in send mode
        this.nextPacketTime = 0;                                                                // and the time to do this
        this.plyStartTime = 0;                                                                  // inluding the time offset to the start of the play mode
        this.plyLoop = false;                                                                   // play the file in a loop till playing is switched off ?
        this.plyFile = '';                                                                      // the file which is opened for playback
        this.mergeMode = 0;                                                                     // 0 = LTP, 1 = HTP
        this.liner = undefined;                                                                 // holds the lineByLine object
        this.tmrSendTimer = setTimeout(() => {
            });
        this.tmrSendTimer.unref();                                                              // holds the send timer for clear in unload

        // creating a udp server
        this.server = udp.createSocket('udp4');
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        try {
            // Initialize your adapter here
            // Reset the connection indicator during startup
            this.setState('info.connection', false, true);

            // emits when any error occurs
            this.server.on('error', this.onServerError.bind(this));

            // emits when socket is ready and listening for datagram msgs
            this.server.on('listening', this.onServerListening.bind(this));

            // emits after the socket is closed using socket.close();
            this.server.on('close', this.onServerClose.bind(this));

            // emits on new datagram msg
            this.server.on('message', this.onServerMessage.bind(this));

            // The adapters config (in the instance object everything under the attribute 'native' is accessible via
            // this.config:

            /*
            * For every state in the system there has to be also an object of type state
            */
            for (const element of this.objectsTemplate.common) {
                await this.setObjectNotExistsAsync(element._id, element);
            }
            for (const element of this.objectsTemplate.control) {
                await this.setObjectNotExistsAsync(`control.${element._id}`, element);
            }

            this.artNetBuffer = Buffer.alloc(Number(this.config.maxDmxAddress));    // create a internal buffer

            // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
            // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
            this.subscribeStates('*');

            // try to open open configured server port
            this.log.info('Bind UDP socket to: "' + this.config.bind + ':' + this.config.port + '"');
            this.server.bind(this.config.port, this.config.bind);

            // check if the given workingDirectory exists.

            let tmpObj = await this.getStateAsync('control.workingDir');
            this.workingDir = (tmpObj && tmpObj.val) ? tmpObj.val.toString() : utils.getAbsoluteInstanceDataDir(this);

            tmpObj = await this.getStateAsync('control.playbackLoop');
            this.plyLoop = (tmpObj && tmpObj.val) ? Boolean(tmpObj.val) : false;

            tmpObj = await this.getStateAsync('control.merge');
            this.mergeMode = (tmpObj && tmpObj.val) ? Number(tmpObj.val) : 0;

            if (fs.existsSync(this.workingDir)) {
                const locWritable = await fs.accessSync(this.workingDir, fs.constants.R_OK | fs.constants.W_OK);
                if (locWritable == undefined) {
                    this.log.info(`Art-Net Recorder working directory: ${this.workingDir} exists and is writable.`);
                } else {
                    this.log.info(`Art-Net Recorder working directory: ${this.workingDir} exists but is not writable. Recording not possible.`);
                    this.canRecord = false;
                }
            } else {
                this.log.error(`Art-Net Recorder working directory: ${this.workingDir} did not exist. Terminating`);
                this.terminate();
            }

            // reset the mode on startup
            this.setState('control.mode', 0, true);

            // last thing to do is to start the onSendTimer
            this.tmrSendTimer = setInterval(this.onSendTimer.bind(this), this.config.packetDelay);

            // Set the connection indicator after startup
            // this.setState('info.connection', true, true);
            // set by onServerListening

        } catch (err) {
            this.errorHandler(err, 'onReady');
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
        try {
            const addr = this.server.address();
            this.log.info('Art-Net Recorder server ready on <' + addr.address + '> port <' + addr.port + '> proto <' + addr.family + '>');
            // maybe subject to change when switching to "real" Art-Net node
            this.server.setBroadcast(true);
            // Set the connection indicator after server goes for listening
            this.setState('info.connection', true, true);
        } catch (err) {
            this.errorHandler(err, 'onServerListening');
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
        try {
            if (info.address === this.config.bind) return;         // packet from own address
            if (msg.length > 530) {
                this.log.debug(`Art-Net Recorder received packet with lenght > 530. Received length: ${msg.length}`);
                return;
            }
            const msg_hex = msg.toString('hex').toUpperCase();
            if (msg.slice(0, 8).compare(this.artNetHeader) != 0) {
                this.log.debug(`Art-Net Recorder received packet with unknown header. Received header: '${msg.slice(0, 8).toString('hex').toUpperCase()}'`);
                this.log.debug(`-> ${msg.length} bytes from ${info.address}:${info.port} : '${this.logHexData(msg_hex)}'`);
                return;
            }
            if (msg.slice(10, 12).compare(this.artNetVersion) != 0) {
                this.log.debug(`Art-Net Recorder received packet with unknown version. Received version: '${msg.slice(10, 12).toString('hex').toUpperCase()}'`);
                this.log.debug(`-> ${msg.length} bytes from ${info.address}:${info.port} : '${this.logHexData(msg_hex)}'`);
                return;
            }
            if (msg.slice(8, 10).compare(this.artNetOpcodecArtDMX) != 0) {
                this.log.debug(`Art-Net Recorder received packet with unknown opcode. Received opcode: '${msg.slice(8, 10).toString('hex').toUpperCase()}'`);
                this.log.debug(`-> ${msg.length} bytes from ${info.address}:${info.port} : '${this.logHexData(msg_hex)}'`);
                return;
            }
            const msgSequence = msg[12];
            const msgPhysical = msg[13];
            const msgNet = msg[15] & 0x7F;                      // delete the Bit 15
            const msgSubNet = (msg[14] & 0xF0) >> 4;
            const msgUniverse = msg[14] & 0x0F;
            const msgLength   = msg[16] * 256 + msg[17];
            if ((msgNet == this.config.net) && (msgSubNet == this.config.subNet) && (msgUniverse == this.config.universe)) {
                this.log.silly(`Art-Net Recorder received packet with ${msg.length} bytes from ${info.address}:${info.port} -> sequence: ${msgSequence}, physical: ${msgPhysical}, universe: '${msgNet}:${msgSubNet}:${msgUniverse} (${msgNet * 256 + msgSubNet * 16 + msgUniverse})', length: ${msgLength} DMX values`);
            } else {
                this.log.silly(`Art-Net Recorder received packet with ${msg.length} bytes from ${info.address}:${info.port} -> sequence: ${msgSequence}, physical: ${msgPhysical}, universe: '${msgNet}:${msgSubNet}:${msgUniverse} (${msgNet * 256 + msgSubNet * 16 + msgUniverse})', length: ${msgLength} DMX values. Universe or Net mismatch. Ignoring`);
                return;
            }
            const dmxVals = msg.slice(18, msg.length);
            if (!this.recordRunning) {          // no recording in progress. Only save the buffer and return
                this.artNetBuffer = dmxVals;
                return;
            }
            // from here there is playback or record running. Check whether it is dirty against the buffer
            const dmxValsChanged = [];
            let isDirty = false;

            for (let actBucket = 0; actBucket < dmxVals.length; actBucket++) {
                if (dmxVals[actBucket] != this.artNetBuffer[actBucket]) {
                    isDirty = true;
                    dmxValsChanged.push({'channel': actBucket + 1, 'value': dmxVals[actBucket]});
                }
            }
            if (isDirty) {
                const locNow = Date.now();
                if (this.recStartTime == 0) {      // first record
                    this.recStartTime = locNow;
                }
                // eslint-disable-next-line no-unused-vars
                const locRecTime = locNow - this.recStartTime;
                //const locObj = {};
                const locStr = JSON.stringify({[locRecTime] : dmxValsChanged});
                fs.appendFile(this.recFile, `${locStr}\n`, (err) => {
                    if (err) throw err;
                    this.log.debug(`Art-Net Recorder append now to record file '${locStr}'`);
                });
            }
            this.artNetBuffer = dmxVals;        // remember the actual DMX value image

        } catch (err) {
            this.errorHandler(err, 'onServerMessage');
        }
    }

    /**
     * Is cyclic called by the send timer to lookup for new packets to send in sendmode
     */
    onSendTimer() {
        let tmpStr, tmpObj;
        try {
            if (!this.playbackRunning) return;              // only action is while playback is running
            const locNow = Date.now() - this.plyStartTime;  // offset !
            if (this.nextPacketTime < locNow) {   // send packet and get next
                this.log.silly(`Art-Net Recorder send packet '${this.nextPacketTime}' on '${locNow}'`);
                // send packet
                this.sendPacket();
                // get next packet or end playback
                tmpStr = this.liner.next();
                if (tmpStr) {
                    tmpObj = JSON.parse(tmpStr);
                    this.nextPacketTime = Number(Object.keys(tmpObj)[0]);
                    this.nextPacketToSend = tmpObj[this.nextPacketTime];
                } else {
                    if (this.plyLoop) {
                        this.log.info(`Art-Net Recorder playback end, restart because of loop mode`);
                        this.plyStartTime = Date.now();
                        this.liner = new lineByLine(this.plyFile, {'readChunk': 15000, 'newLineCharacter': '\n'});
                        tmpStr = this.liner.next();
                        if (tmpStr) {
                            tmpObj = JSON.parse(tmpStr);
                            this.nextPacketTime = Number(Object.keys(tmpObj)[0]);
                            this.nextPacketToSend = tmpObj[this.nextPacketTime];
                            this.plyStartTime = Date.now();
                            this.playbackRunning = true;
                        } else {
                            this.log.error(`Art-Net Recorder error: File '${this.plyFile}' is now empty or corrupted. No playback possible`);
                            this.playbackRunning = false;
                            if (this.liner) this.liner.close();     // close playback file if open
                        }
                    } else {
                        this.log.info(`Art-Net Recorder ended playback`);
                        this.playbackRunning = false;
                        this.setState('control.mode', 0, true);
                    }
                }

            }
        } catch (err) {
            this.errorHandler(err, 'onSendTimer');
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        let tmpObj;
        let tmpStr;
        try {
            if (state) {
                // The state was changed
                // self.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                if (!state.ack) {                   // only react on not acknowledged state changes
                    if (state.lc === state.ts) {    // last changed and last updated equal then the value has changed
                        this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
                        if (/mode/.test(id)) {
                            this.log.info(`Art-Net Recorder mode ${id} changed to ${state.val}`);
                            this.playbackRunning = false;
                            this.recordRunning = false;
                            switch (state.val) {
                                case 1:             // Record
                                    if (this.canRecord) {
                                        this.recordRunning = true;
                                        this.createRecordFile();
                                        this.log.info(`Art-Net Recorder switched to Record mode`);
                                        if (this.liner) this.liner.close();     // close playback file if open
                                    } else {
                                        this.log.warn(`Art-Net Recorder can not record. No writable directory`);
                                        this.setState('control.mode', 0, true);
                                    }
                                    break;

                                case 2:             // Playback
                                this.log.info(`Art-Net Recorder switched to Playback mode`);
                                    tmpObj = await this.getStateAsync('control.file');
                                    this.plyFile = `${this.workingDir}/${(tmpObj && tmpObj.val) ? tmpObj.val.toString() : ''}`;
                                    if (fs.existsSync(this.plyFile)) {
                                        this.liner = new lineByLine(this.plyFile, {'readChunk': 15000, 'newLineCharacter': '\n'});
                                        //this.liner.reset();             // when debugging there were sometimes strange effects
                                        tmpStr = this.liner.next();
                                        if (tmpStr) {
                                            tmpObj = JSON.parse(tmpStr);
                                            this.nextPacketTime = Number(Object.keys(tmpObj)[0]);
                                            this.nextPacketToSend = tmpObj[this.nextPacketTime];
                                            this.plyStartTime = Date.now();
                                            this.playbackRunning = true;
                                        } else {
                                            this.log.error(`Art-Net Recorder error: File '${this.plyFile}' is empty or corrupted. No playback possible`);
                                            this.playbackRunning = false;
                                            if (this.liner) this.liner.close();     // close playback file if open
                                        }
                                    } else {
                                        this.log.error(`Art-Net Recorder error: File '${this.plyFile}' does not exist. No playback possible`);
                                        this.playbackRunning = false;
                                        this.setState('control.mode', 0, true);
                                    }
                                    break;

                                default:
                                    this.log.info(`Art-Net Recorder switched off`);
                            }
                        }
                        if (/workingDir/.test(id)) {
                            this.log.info(`Art-Net Recorder changed working dir`);
                            this.workingDir = state.val ? state.val.toString() : '';
                        }
                        if (/playbackLoop/.test(id)) {
                            this.log.info(`Art-Net Recorder changed loop mode`);
                            this.plyLoop = state.val ? true : false;
                        }
                        if (/merge/.test(id)) {
                            this.log.info(`Art-Net Recorder changed merge mode`);
                            this.mergeMode = Number(state.val);
                        }
                        this.log.debug(`state ${id} only updated not changed: ${state.val} (ack = ${state.ack})`);
                    }
                }
            } else {
                // The state was deleted
                this.log.info(`state ${id} deleted`);
            }
        } catch (err) {
            this.errorHandler(err, 'onStateChange');
        }
    }

    /**
     * Called for creating a new file for recording
	 */
    createRecordFile() {
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
            this.recFile = `${this.workingDir}/${locFileName}`;
            this.recStartTime = 0;          // reset for first recording
            this.log.error(`Art-Net Recorder create filename: '${locFileName}' for recording`);
        } catch (err) {
            this.errorHandler(err, 'createRecordFile');
        }
    }

    /**
     * Called for merging and sending a packet
	 */
    sendPacket() {
        try {
            // merge nextPacketToSend to the dmx buffer depending on the merge mode
            for (const element of this.nextPacketToSend) {
                if (this.mergeMode) {           // if 0 (LTP) the provided values from the playback must be set
                    this.artNetBuffer[element.channel - 1] = Number(element.value);
                } else {                        // HTP only set value if it is bigger than the bufferd value
                    if (this.artNetBuffer[element.channel - 1] < Number(element.value)) {
                        this.artNetBuffer[element.channel - 1] = Number(element.value);
                    }
                }
            }
            this.server.send(this.getArtNetPacket(), this.config.port, '255.255.255.255');
        } catch (err) {
            this.errorHandler(err, 'sendPacket');
        }
    }

    /**
     * Called for building a valid ArtDMX packet
     * @returns {Uint8Array}
	 */
    getArtNetPacket() {
        let locBuffer = this.artNetHeader;
        try {
            locBuffer = Buffer.concat([locBuffer, new Uint8Array([0x00, 0x50])]);   // Opcode 0x5000 (ArtDMX)
            locBuffer = Buffer.concat([locBuffer, this.artNetVersion]);             // Version 14
            locBuffer = Buffer.concat([locBuffer, new Uint8Array([0x00, 0x00])]);   // Sequence and physical is 0 for now
            /*
            locBuffer = Buffer.concat([locBuffer, new Uint8Array([0x00, 0x00])]);   // Universe only 0 for now
            const statusByte = 0xE0 + Number(channelInBank)-1;
            const dataByte2 = Math.floor(Number(logObj.midiValue) / 128).toFixed(0);
            const dataByte1 = Math.floor(Number(logObj.midiValue) - (Number(dataByte2) * 128)).toFixed(0);
            const midiCommand = new Uint8Array([statusByte, Number(dataByte1), Number(dataByte2)]);
            */
            // Low Byte is Net, High Byte is Subnet and Universe (little endian !)
            const universeHiByte = (Number(this.config.subNet) << 4) | Number(this.config.universe);
            const lengthHiByte = Math.floor(Number(this.artNetBuffer.length) / 256).toFixed(0);
            const lengthLoByte = Math.floor(Number(this.artNetBuffer.length) - (Number(lengthHiByte) * 256)).toFixed(0);
            locBuffer = Buffer.concat([locBuffer, new Uint8Array([Number(universeHiByte), this.config.net, Number(lengthHiByte), Number(lengthLoByte)]), this.artNetBuffer]);
        } catch (err) {
            this.errorHandler(err, 'getArtNetPacket');
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
            // Reset the connection indicator
            this.setState('info.connection', false, true);
            // reset the mode
            this.setState('control.mode', 0, true);

            // Here you must clear all timeouts or intervals that may still be active
            clearInterval(this.tmrSendTimer);

            // close playback file if open
            if (this.liner) this.liner.close();

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
    module.exports = (options) => new ArtnetRecorder(options);
} else {
    // otherwise start the instance directly
    new ArtnetRecorder();
}