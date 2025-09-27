import _ from 'lodash';
import path from 'path';
import { isRoomName, isRoomPosition, printPos, serverRequire, log } from './utils';
import type commonMod from '@screeps/common';
import type utilsMod from '@screeps/backend/lib/utils.js';
import { CreatePortalOpts, PortalOpts, PortalModSettings } from './types';

const common = serverRequire('@screeps/common') as typeof commonMod;
const utils = serverRequire('@screeps/backend/lib/utils.js') as typeof utilsMod;

const DEFAULTS: PortalModSettings = {
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

function checkPosition(pos: unknown): [roomName: RoomName, pos: RoomPosition | undefined] {
	let roomName: string;
	let roomPos: RoomPosition | undefined;
	if (!isRoomPosition(pos)) {
		if (!isRoomName(pos)) {
			throw new Error(`Invalid position "${pos}"`);
		}
		roomName = pos;
	} else {
		roomPos = pos;
		roomName = roomPos.room;
	}
	return [roomName, roomPos];
}

export default function (config: ServerConfig) {
	const C = config.common.constants;
	const { env, db } = config.common.storage;

	async function isValidPortalLocation(roomName: RoomName, x: number, y: number, core: boolean) {
		const objects = (await db['rooms.objects'].find({ room: roomName })) as RoomObject[];
		const terrain = (await db['rooms.terrain'].findOne({
			room: roomName,
		})) as RoomTerrain;

		const checkCoord = (x: number, y: number) => {
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
		} else {
			if (!checkCoord(x, y)) {
				return false;
			}
		}

		return true;
	}

	function isRange(r: unknown, minValue?: number, maxValue?: number) {
		return (
			Array.isArray(r) &&
			r.length === 2 &&
			r.every(
				(n) =>
					typeof n === 'number' &&
					(minValue === undefined || n >= 0) &&
					(maxValue === undefined || n <= maxValue)
			) &&
			r[0] < r[1]
		);
	}

	function inRange(n: number, min: number, max: number) {
		return n >= min && n <= max;
	}

	config.portal = {
		settings: Object.assign({}, DEFAULTS) as PortalModSettings,
		loadSettings: function (data: Partial<PortalModSettings>) {
			const settings: Partial<PortalModSettings> = {};
			if ('maxPairs' in data && (typeof data.maxPairs !== 'number' || data.maxPairs < 0)) {
				log('error', `invalid value for 'maxPairs', using default`);
			} else {
				settings.maxPairs = data.maxPairs;
			}
			if (data.distance && !isRange(data.distance, 0)) {
				log('error', `invalid value for 'distance', using default`);
			} else {
				settings.distance = data.distance;
			}
			if (data.decayTimeRange && !_.isFinite(data.decayTimeRange) && !isRange(data.decayTimeRange, 0)) {
				log('error', `invalid value for 'decayTimeRange', using default`);
			} else {
				settings.decayTimeRange = data.decayTimeRange;
			}
			if (data.unstableDateRange && !_.isFinite(data.unstableDateRange) && !isRange(data.unstableDateRange, 0)) {
				log('error', `invalid value for 'unstableDateRange', using default`);
			} else {
				settings.unstableDateRange = data.unstableDateRange;
			}
			if (data.chance && !_.isPlainObject(data.chance)) {
				log('error', `invalid value for 'chance', using default`);
			} else if (data.chance) {
				if (!inRange(data.chance.decay, 0, 1)) {
					log('error', `invalid value for 'chance.decay', using default`);
				} else {
					(settings.chance ??= {} as PortalModSettings['chance']).decay = data.chance.decay;
				}
				if (!inRange(data.chance.unstable, 0, 1)) {
					log('error', `invalid value for 'chance.stray', using default`);
				} else {
					(settings.chance ??= {} as PortalModSettings['chance']).unstable = data.chance.unstable;
				}
				if (!inRange(data.chance.oneWay, 0, 1)) {
					log('error', `invalid value for 'chance.oneWay', using default`);
				} else {
					(settings.chance ??= {} as PortalModSettings['chance']).oneWay = data.chance.oneWay;
				}
				if (!inRange(data.chance.stray, 0, 1)) {
					log('error', `invalid value for 'chance.stray', using default`);
				} else {
					(settings.chance ??= {} as PortalModSettings['chance']).stray = data.chance.stray;
				}
			}
			this.settings = _.defaultsDeep({}, settings, DEFAULTS);
			log('debug', `settings: ${JSON.stringify(this.settings, undefined, ' ')}`);
		},
		createPortalPair: async function (
			src: string | RoomPosition,
			dst: string | RoomPosition,
			_opts: Partial<CreatePortalOpts> = {}
		) {
			const opts = _.defaults<CreatePortalOpts>({}, _opts, {
				decayTime: undefined,
				unstableDate: undefined,
				oneWay: false,
				core: false,
			});

			let portalOpts: PortalOpts = {};
			if (opts.decayTime && opts.unstableDate) {
				throw new Error("can't specify both decayTime and unstableDate");
			} else if (opts.decayTime) {
				portalOpts.decayTime = opts.decayTime;
			} else if (opts.unstableDate) {
				portalOpts.unstableDate = opts.unstableDate;
			}

			let [srcRoom, srcPos] = checkPosition(src);
			let [dstRoom, dstPos] = checkPosition(dst);

			log(
				'info',
				`creating portal from ${srcPos ? printPos(srcPos) : srcRoom} to ${dstPos ? printPos(dstPos) : dstRoom}: opts: ${JSON.stringify(portalOpts)}`
			);

			const srcTerrain = (await db['rooms.terrain'].findOne({
				room: src,
			})) as RoomTerrain;
			if (!srcTerrain) {
				throw new Error('Source room does not exist');
			}
			const dstTerrain = (await db['rooms.terrain'].findOne({
				room: dst,
			})) as RoomTerrain;
			if (!dstTerrain) {
				throw new Error('Destination room does not exist');
			}

			if (!srcPos) {
				const coords = await utils.findFreePos(srcRoom, opts.core ? 1 : 0);
				srcPos = { ...coords, room: srcRoom };
			} else if (!isValidPortalLocation(srcPos.room, srcPos.x, srcPos.y, opts.core!)) {
				throw new Error(`source position ${srcPos} is invalid for a portal`);
			}
			if (!dstPos) {
				const coords = await utils.findFreePos(dstRoom, opts.core ? 1 : 0);
				dstPos = { ...coords, room: dstRoom };
			} else if (!isValidPortalLocation(dstPos.room, dstPos.x, dstPos.y, opts.core!)) {
				throw new Error(`destination position ${dstPos} is invalid for a portal`);
			}

			if (opts.core) {
				for (const x of _.range(-1, 2)) {
					for (const y of _.range(-1, 2)) {
						const coreSrc = { x: srcPos.x + x, y: srcPos.y + y, room: srcPos.room };
						const coreDst = { x: dstPos.x + x, y: dstPos.y + y, room: dstPos.room };
						if (x === 0 && y === 0) {
							// Make an eternal center wall; the portal decay handles removing those
							let wall: WallObject = { ...coreSrc, type: 'constructedWall' };
							await db['rooms.objects'].insert(wall);
							if (!opts.oneWay) {
								wall = { ...coreDst, type: 'constructedWall' };
								await db['rooms.objects'].insert(wall);
							}
						} else {
							this.makePortal(coreSrc, coreDst, portalOpts);
							if (!opts.oneWay) {
								this.makePortal(coreDst, coreSrc, portalOpts);
							}
						}
					}
				}
			} else {
				this.makePortal(srcPos, dstPos, portalOpts);
				if (!opts.oneWay) {
					this.makePortal(dstPos, srcPos, portalOpts);
				}
			}
		},

		makePortal: async function (pos: RoomPosition, destPos: RoomPosition, opts?: PortalOpts) {
			log('info', `makePortal: ${printPos(pos)}, ${printPos(destPos)}, opts: ${JSON.stringify(opts)}`);

			if (!isRoomPosition(pos) || !isRoomPosition(destPos)) {
				throw new Error('Invalid portal positions!');
			}

			let unstableDate: number | undefined = undefined;
			let decayTime: number | undefined = undefined;
			if (opts?.decayTime && opts?.unstableDate) {
				throw new Error("can't specify both decayTime and unstableDate");
			} else if (opts?.unstableDate) {
				if (!_.isFinite(opts.unstableDate) || opts.unstableDate <= 0) {
					throw new Error(`unstableDate must be a positive integer`);
				} else if (opts.unstableDate < Date.now()) {
					throw new Error(`unstableDate is in the past?`);
				}
				unstableDate = Math.round(opts.unstableDate);
			} else if (opts?.decayTime) {
				let decay: number;
				if (_.isBoolean(opts.decayTime)) {
					decay = C.PORTAL_DECAY;
				} else if (_.isFinite(opts.decayTime) && opts.decayTime > 0) {
					decay = opts.decayTime;
				} else {
					throw new Error(`decayTime must be a positive integer or a boolean`);
				}
				const tick = await common.getGametime();
				decayTime = tick + decay;
			}

			const portal: PortalObject = {
				room: pos.room,
				x: pos.x,
				y: pos.y,
				type: 'portal',
				destination: destPos,
			};
			if (unstableDate) portal.unstableDate = Math.round(unstableDate);
			else if (decayTime) portal.decayTime = Math.round(decayTime);

			log('debug', `portal: ${JSON.stringify(portal)}`);
			db['rooms.objects'].insert(portal);
		},
	};
}
