'use strict';

var _ = require('lodash');
var path = require('path');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

var ___default = /*#__PURE__*/_interopDefaultLegacy(_);
var path__default = /*#__PURE__*/_interopDefaultLegacy(path);

const serverModulesDir = path__default["default"].resolve(process.cwd(), 'node_modules');
function serverRequire(id) {
    return require(require.resolve(id, { paths: [serverModulesDir] }));
}
function log(level, ...args) {
    console[level]('[portals]', ...args);
}
function isRoomName(roomName) {
    return typeof roomName === 'string' && /^[WE]\d+[NS]\d+$/.test(roomName);
}
function isRoomPosition(obj) {
    if (typeof obj !== 'object' ||
        !obj ||
        !('room' in obj) ||
        typeof obj.room !== 'string' ||
        !isRoomName(obj.room) ||
        !('x' in obj) ||
        typeof obj.x !== 'number' ||
        obj.x < 0 ||
        obj.x > 49 ||
        !('y' in obj) ||
        typeof obj.y !== 'number' ||
        obj.y < 0 ||
        obj.y > 49) {
        return false;
    }
    return true;
}
function printPos(pos) {
    return JSON.stringify(pos);
}
function isSamePos(pos1, pos2) {
    return pos1.x === pos2.x && pos1.y === pos2.y && pos1.room === pos2.room;
}
function isInRangeTo(pos1, pos2, range) {
    return (pos1.room === pos2.room &&
        ___default["default"].inRange(pos1.x, pos2.x - range, pos2.x + range + 1) &&
        ___default["default"].inRange(pos1.y, pos2.y - range, pos2.y + range + 1));
}
var RoomType;
(function (RoomType) {
    RoomType["NORMAL"] = "normal";
    RoomType["CORE"] = "core";
    RoomType["CROSSROADS"] = "crossroads";
})(RoomType || (RoomType = {}));
function roomType(room) {
    const name = ___default["default"].isString(room) ? room : room.name;
    if (isCore(name))
        return RoomType.CORE;
    else if (isCrossroads(name))
        return RoomType.CROSSROADS;
    // TODO: incomplete
    return RoomType.NORMAL;
}
function isCrossroads(room) {
    const name = ___default["default"].isString(room) ? room : room.name;
    return !!name.match(/[EW]\d*0[NS]\d*0/);
}
function isCore(room) {
    const name = ___default["default"].isString(room) ? room : room.name;
    return !!name.match(/[EW]\d*5[NS]\d*5/);
}
/**
 * Check whether {@link r} represents a range.
 *
 * @param r The range to check
 * @param minValue The expected lower bound of the range
 * @param maxValue The expected upper bound of the range
 */
function isRange(r, minValue, maxValue) {
    return (Array.isArray(r) &&
        r.length === 2 &&
        r.every((n) => typeof n === 'number' && (minValue === undefined || n >= 0) && (maxValue === undefined || n <= maxValue)) &&
        r[0] < r[1]);
}
/**
 * Check whether a number lies within [min, max]
 */
function isNumberBetween(n, min, max) {
    return n >= min && n <= max;
}

const utils$2 = serverRequire('@screeps/backend/lib/utils.js');
// const engineUtils = serverRequire('@screeps/engine/src/utils.js');
function cli (config, sandbox) {
    sandbox.map.createPortal = utils$2.withHelp([
        'createPortal(srcRoom: string | {x, y, room}, dstRoom: string | {x, y, room}, [opts]) - Create a portal between two rooms (or positions).\n' +
            '    `opts` is an object with the following optional properties:\n' +
            '    * `decayTime` - number of ticks before the portal decays and disappears, or true if you want the default decaying duration\n' +
            '    * `unstableDate` - a timestamp of when the portal should start decaying\n' +
            '    * `oneWay` - create only one portal from source to dest\n' +
            '    * `core` - create an 3x3 rings of portals around a constructed wall (the position is in the center)',
        async function (src, dst, opts) {
            await config.portal.createPortalPair(src, dst, opts);
            return 'OK';
        },
    ]);
    // Regenerate the help message to show our new commands
    sandbox.map._help = utils$2.generateCliHelp('map.', sandbox.map);
}

const utils$1 = serverRequire('@screeps/backend/lib/utils.js');
serverRequire('@screeps/common');
function cronjobs (config) {
    config.cronjobs.refreshPortals = [300, () => refreshPortals(config)];
}
async function refreshPortals(config) {
    const { db } = config.common.storage;
    const { maxPairs, distance: [minDistance, maxDistance], chance, unstableDateRange, decayTimeRange, } = config.portal.settings;
    log('info', `Refreshing portals`);
    // We make a list of all the portals we know about
    const oneWay = new Set();
    const pairs = new Map();
    const portals = (await db['rooms.objects'].find({ type: 'portal' }));
    const corePortals = new Set();
    for (const portal of portals) {
        const pair = portals.find((p) => isSamePos(p, portal.destination));
        const roomPortals = portals.filter((p) => p.room === portal.room);
        // Core portal detection
        if (corePortals.has(portal)) {
            continue;
        }
        const walls = (await db['rooms.objects'].find({ type: 'constructedWall', room: portal.room }));
        if (walls.length && roomPortals.length) {
            const closePortals = roomPortals.filter((p) => walls.some((w) => isInRangeTo(p, w, 1)));
            if (closePortals.length === 8) {
                closePortals.forEach((p) => corePortals.add(p));
            }
        }
        if (pair) {
            pairs.set(portal, pair);
            pairs.set(pair, portal);
        }
        else {
            oneWay.add(portal);
        }
    }
    let numPairs = pairs.size / 2 + oneWay.size;
    log('debug', `${pairs.size / 2} portal pairs: ${[...pairs.entries()].map(([p1, p2]) => `${p1.room} => ${p2.room}`)}`);
    log('debug', `${oneWay.size} one-way portals: ${[...oneWay.values()].map((p) => `${p.room} => ${p.destination.room}`)}`);
    const allRooms = (await db['rooms'].find({ status: 'normal' }));
    const possibleRooms = new Set(allRooms.filter((r) => isCore(r) || isCrossroads(r)));
    log('debug', `portalRooms: ${[...possibleRooms.values()].map((r) => r.name)}`);
    let limit = 10;
    while (numPairs < maxPairs && limit > 0) {
        log('debug', `missing ${maxPairs - numPairs}`);
        const isStray = chance.stray !== 0 && Math.random() <= chance.stray;
        let portalRooms = isStray ? allRooms : [...possibleRooms];
        const srcRoom = ___default["default"].sample(portalRooms);
        if (!srcRoom)
            break;
        possibleRooms.delete(srcRoom);
        if (!isStray) {
            portalRooms = [...possibleRooms];
        }
        const portalsInRoom = (await db['rooms.objects'].find({
            room: srcRoom.name,
            type: 'portal',
        }));
        if (isCore(srcRoom) && portalsInRoom.length > 0) {
            // We don't allow multiple portals in a core room
            limit--;
            continue;
        }
        // Helper function to select a proper destination
        const pickRandomDestination = (room) => {
            const [roomX, roomY] = utils$1.roomNameToXY(room.name);
            log('debug', `picked ${isStray ? 'stray ' : ''}room ${room.name} (${roomX}, ${roomY}), checking rooms in range ${minDistance}-${maxDistance}`);
            const candidates = portalRooms.filter((r) => {
                if (r.status !== room.status)
                    return false;
                if (!isStray && roomType(r) !== roomType(room))
                    return false;
                if (portalsInRoom.find((p) => p.destination.room === r.name)) {
                    log('debug', `portal between ${srcRoom.name} and ${r.name} already exist, ignoring`);
                    // There's already a portal linking back to this room, skip!
                    return false;
                }
                const [rX, rY] = utils$1.roomNameToXY(r.name);
                const [xDist, yDist] = [Math.abs(roomX - rX), Math.abs(roomY - rY)];
                const valid = xDist >= minDistance && yDist >= minDistance && xDist < maxDistance && yDist < maxDistance;
                log('debug', `checking ${r.name} (${rX}, ${rY}): ${xDist}, ${yDist} => ${valid}`);
                return valid;
            });
            return ___default["default"].sample(candidates);
        };
        const dstRoom = pickRandomDestination(srcRoom);
        if (!dstRoom) {
            log('debug', `no good destination room for ${srcRoom.name}`);
            limit--;
            continue;
        }
        log('debug', `selected destination rooms for ${srcRoom.name}: ${dstRoom.name}`);
        possibleRooms.delete(dstRoom);
        const opts = { core: isCore(srcRoom) };
        if (chance.oneWay !== 0 && Math.random() <= chance.oneWay) {
            opts.oneWay = true;
        }
        if (chance.unstable !== 0 && Math.random() <= chance.unstable) {
            if (___default["default"].isNumber(unstableDateRange)) {
                opts.unstableDate = Date.now() + unstableDateRange;
            }
            else {
                opts.unstableDate = Date.now() + ___default["default"].random(...unstableDateRange);
            }
        }
        else if (chance.decay !== 0 && Math.random() <= chance.decay) {
            if (___default["default"].isNumber(decayTimeRange)) {
                opts.decayTime = decayTimeRange;
            }
            else if (decayTimeRange === undefined) {
                opts.decayTime = true;
            }
            else {
                opts.decayTime = ___default["default"].random(...decayTimeRange);
            }
        }
        await config.portal.createPortalPair(srcRoom.name, dstRoom.name, opts);
        numPairs++;
        limit--;
    }
}

function backend (config) {
    var _a;
    cronjobs(config);
    (_a = config.utils) === null || _a === void 0 ? void 0 : _a.on('config:update:portals', (data) => {
        log('info', 'portals config reload!', data);
        config.portal.loadSettings(data);
    });
    config.cli.on('cliSandbox', function (sandbox) {
        cli(config, sandbox);
    });
}

const common = serverRequire('@screeps/common');
const utils = serverRequire('@screeps/backend/lib/utils.js');
const DEFAULTS = {
    maxPairs: 10,
    distance: [15, Infinity],
    chance: {
        decay: 0,
        unstable: 1,
        stray: 0,
        oneWay: 0,
    },
    decayTimeRange: undefined,
    unstableDateRange: 24 * 60 * 60 * 1000,
};
function checkPosition(pos) {
    let roomName;
    let roomPos;
    if (!isRoomPosition(pos)) {
        if (!isRoomName(pos)) {
            throw new Error(`Invalid position "${pos}"`);
        }
        roomName = pos;
    }
    else {
        roomPos = pos;
        roomName = roomPos.room;
    }
    return [roomName, roomPos];
}
function common$1 (config) {
    const C = config.common.constants;
    const { env, db } = config.common.storage;
    /** Ensure the given room position can have a portal dropped on it without overlapping anything */
    async function isValidPortalLocation(roomName, x, y, core) {
        const objects = (await db['rooms.objects'].find({ room: roomName }));
        const terrain = (await db['rooms.terrain'].findOne({
            room: roomName,
        }));
        /** Helper to quickly check for blockers at a position */
        const checkCoord = (x, y) => {
            if (!common.checkTerrain(terrain.terrain, x, y, C.TERRAIN_MASK_WALL)) {
                return false;
            }
            if (objects.some((obj) => !C.OBSTACLE_OBJECT_TYPES.concat(['rampart', 'portal']).includes(obj.type))) {
                return false;
            }
            return true;
        };
        if (core) {
            for (let xx = -1; xx < 1; xx++) {
                for (let yy = -1; yy < 1; yy++) {
                    if (!checkCoord(x + xx, y + yy)) {
                        return false;
                    }
                }
            }
        }
        else {
            if (!checkCoord(x, y)) {
                return false;
            }
        }
        return true;
    }
    function loadSettings(data) {
        var _a, _b, _c, _d;
        const settings = {};
        if ('maxPairs' in data && (typeof data.maxPairs !== 'number' || data.maxPairs < 0)) {
            log('error', `invalid value for 'maxPairs', using default`);
        }
        else {
            settings.maxPairs = data.maxPairs;
        }
        if (data.distance && !isRange(data.distance, 0)) {
            log('error', `invalid value for 'distance', using default`);
        }
        else {
            settings.distance = data.distance;
        }
        if (data.decayTimeRange && !___default["default"].isFinite(data.decayTimeRange) && !isRange(data.decayTimeRange, 0)) {
            log('error', `invalid value for 'decayTimeRange', using default`);
        }
        else {
            settings.decayTimeRange = data.decayTimeRange;
        }
        if (data.unstableDateRange && !___default["default"].isFinite(data.unstableDateRange) && !isRange(data.unstableDateRange, 0)) {
            log('error', `invalid value for 'unstableDateRange', using default`);
        }
        else {
            settings.unstableDateRange = data.unstableDateRange;
        }
        if (data.chance && !___default["default"].isPlainObject(data.chance)) {
            log('error', `invalid value for 'chance', using default`);
        }
        else if (data.chance) {
            if (!isNumberBetween(data.chance.decay, 0, 1)) {
                log('error', `invalid value for 'chance.decay', using default`);
            }
            else {
                ((_a = settings.chance) !== null && _a !== void 0 ? _a : (settings.chance = {})).decay = data.chance.decay;
            }
            if (!isNumberBetween(data.chance.unstable, 0, 1)) {
                log('error', `invalid value for 'chance.stray', using default`);
            }
            else {
                ((_b = settings.chance) !== null && _b !== void 0 ? _b : (settings.chance = {})).unstable = data.chance.unstable;
            }
            if (!isNumberBetween(data.chance.oneWay, 0, 1)) {
                log('error', `invalid value for 'chance.oneWay', using default`);
            }
            else {
                ((_c = settings.chance) !== null && _c !== void 0 ? _c : (settings.chance = {})).oneWay = data.chance.oneWay;
            }
            if (!isNumberBetween(data.chance.stray, 0, 1)) {
                log('error', `invalid value for 'chance.stray', using default`);
            }
            else {
                ((_d = settings.chance) !== null && _d !== void 0 ? _d : (settings.chance = {})).stray = data.chance.stray;
            }
        }
        config.portal.settings = ___default["default"].defaultsDeep({}, settings, DEFAULTS);
        log('debug', `settings: ${JSON.stringify(config.portal.settings, undefined, ' ')}`);
    }
    /**
     * Create a portal pair.
     *
     * This is the higher-level function. It'll automatically select proper source & destination positions
     * within their respective rooms if the arguments are room names. It's also handling the nuance of core
     * vs. non-core portals; placing the center wall and the circle of cross-linked portals for the former.
     */
    async function createPortalPair(src, dst, _opts = {}) {
        const defaults = {
            decayTime: undefined,
            unstableDate: undefined,
            oneWay: false,
            core: false,
        };
        const opts = ___default["default"].defaults({}, _opts, defaults);
        let portalOpts = {};
        if (opts.decayTime && opts.unstableDate) {
            throw new Error("can't specify both decayTime and unstableDate");
        }
        else if (opts.decayTime) {
            portalOpts.decayTime = opts.decayTime;
        }
        else if (opts.unstableDate) {
            portalOpts.unstableDate = opts.unstableDate;
        }
        let [srcRoom, srcPos] = checkPosition(src);
        let [dstRoom, dstPos] = checkPosition(dst);
        log('info', `creating portal from ${srcPos ? printPos(srcPos) : srcRoom} to ${dstPos ? printPos(dstPos) : dstRoom}: opts: ${JSON.stringify(portalOpts)}`);
        const srcTerrain = (await db['rooms.terrain'].findOne({
            room: src,
        }));
        if (!srcTerrain) {
            throw new Error('Source room does not exist');
        }
        const dstTerrain = (await db['rooms.terrain'].findOne({
            room: dst,
        }));
        if (!dstTerrain) {
            throw new Error('Destination room does not exist');
        }
        if (!srcPos) {
            const coords = await utils.findFreePos(srcRoom, opts.core ? 1 : 0);
            srcPos = { ...coords, room: srcRoom };
        }
        else if (!isValidPortalLocation(srcPos.room, srcPos.x, srcPos.y, opts.core)) {
            throw new Error(`source position ${srcPos} is invalid for a portal`);
        }
        if (!dstPos) {
            const coords = await utils.findFreePos(dstRoom, opts.core ? 1 : 0);
            dstPos = { ...coords, room: dstRoom };
        }
        else if (!isValidPortalLocation(dstPos.room, dstPos.x, dstPos.y, opts.core)) {
            throw new Error(`destination position ${dstPos} is invalid for a portal`);
        }
        if (opts.core) {
            for (const x of ___default["default"].range(-1, 2)) {
                for (const y of ___default["default"].range(-1, 2)) {
                    const coreSrc = { x: srcPos.x + x, y: srcPos.y + y, room: srcPos.room };
                    const coreDst = { x: dstPos.x + x, y: dstPos.y + y, room: dstPos.room };
                    if (x === 0 && y === 0) {
                        // Make an eternal center wall; the portal decay handles removing those
                        let wall = { ...coreSrc, type: 'constructedWall' };
                        await db['rooms.objects'].insert(wall);
                        if (!opts.oneWay) {
                            wall = { ...coreDst, type: 'constructedWall' };
                            await db['rooms.objects'].insert(wall);
                        }
                    }
                    else {
                        makePortal(coreSrc, coreDst, portalOpts);
                        if (!opts.oneWay) {
                            makePortal(coreDst, coreSrc, portalOpts);
                        }
                    }
                }
            }
        }
        else {
            makePortal(srcPos, dstPos, portalOpts);
            if (!opts.oneWay) {
                makePortal(dstPos, srcPos, portalOpts);
            }
        }
    }
    /**
     * Creates an uni-directional portal between two positions
     */
    async function makePortal(pos, destPos, opts) {
        log('info', `makePortal: ${printPos(pos)}, ${printPos(destPos)}, opts: ${JSON.stringify(opts)}`);
        if (!isRoomPosition(pos) || !isRoomPosition(destPos)) {
            throw new Error('Invalid portal positions!');
        }
        let unstableDate = undefined;
        let decayTime = undefined;
        if ((opts === null || opts === void 0 ? void 0 : opts.decayTime) && (opts === null || opts === void 0 ? void 0 : opts.unstableDate)) {
            throw new Error("can't specify both decayTime and unstableDate");
        }
        else if (opts === null || opts === void 0 ? void 0 : opts.unstableDate) {
            if (!___default["default"].isFinite(opts.unstableDate) || opts.unstableDate <= 0) {
                throw new Error(`unstableDate must be a positive integer`);
            }
            else if (opts.unstableDate < Date.now()) {
                throw new Error(`unstableDate is in the past?`);
            }
            unstableDate = Math.round(opts.unstableDate);
        }
        else if (opts === null || opts === void 0 ? void 0 : opts.decayTime) {
            let decay;
            if (___default["default"].isBoolean(opts.decayTime)) {
                decay = C.PORTAL_DECAY;
            }
            else if (___default["default"].isFinite(opts.decayTime) && opts.decayTime > 0) {
                decay = opts.decayTime;
            }
            else {
                throw new Error(`decayTime must be a positive integer or a boolean`);
            }
            const tick = await common.getGametime();
            decayTime = tick + decay;
        }
        const portal = {
            room: pos.room,
            x: pos.x,
            y: pos.y,
            type: 'portal',
            destination: destPos,
        };
        if (unstableDate)
            portal.unstableDate = Math.round(unstableDate);
        else if (decayTime)
            portal.decayTime = Math.round(decayTime);
        log('debug', `portal: ${JSON.stringify(portal)}`);
        db['rooms.objects'].insert(portal);
    }
    config.portal = {
        settings: Object.assign({}, DEFAULTS),
        loadSettings,
        createPortalPair,
        makePortal,
    };
}

function index (config) {
    common$1(config);
    if (config.backend)
        backend(config);
}

module.exports = index;
