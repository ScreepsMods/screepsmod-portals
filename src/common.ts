import _ from 'lodash';
import {
	isRoomName,
	isRoomPosition,
	printPos,
	serverRequire,
	log,
	isRange,
	isNumberBetween,
	isSamePos,
	isInRangeTo,
} from './utils';
import type commonMod from '@screeps/common';
import type utilsMod from '@screeps/backend/lib/utils.js';
import { CreatePortalOpts, PortalOpts, PortalModSettings, RemovePortalOpts } from './types';

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
	let roomName: RoomName;
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

	/** Ensure the given room position can have a portal dropped on it without overlapping anything */
	async function isValidPortalLocation(roomName: RoomName, x: number, y: number, core: boolean) {
		const objects = (await db['rooms.objects'].find({ room: roomName })) as RoomObject[];
		const terrain = (await db['rooms.terrain'].findOne({
			room: roomName,
		})) as RoomTerrain;

		/** Helper to quickly check for blockers at a position */
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

	function loadSettings(data: Partial<PortalModSettings>) {
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
			if (!isNumberBetween(data.chance.decay, 0, 1)) {
				log('error', `invalid value for 'chance.decay', using default`);
			} else {
				(settings.chance ??= {} as PortalModSettings['chance']).decay = data.chance.decay;
			}
			if (!isNumberBetween(data.chance.unstable, 0, 1)) {
				log('error', `invalid value for 'chance.stray', using default`);
			} else {
				(settings.chance ??= {} as PortalModSettings['chance']).unstable = data.chance.unstable;
			}
			if (!isNumberBetween(data.chance.oneWay, 0, 1)) {
				log('error', `invalid value for 'chance.oneWay', using default`);
			} else {
				(settings.chance ??= {} as PortalModSettings['chance']).oneWay = data.chance.oneWay;
			}
			if (!isNumberBetween(data.chance.stray, 0, 1)) {
				log('error', `invalid value for 'chance.stray', using default`);
			} else {
				(settings.chance ??= {} as PortalModSettings['chance']).stray = data.chance.stray;
			}
		}
		config.portal.settings = _.defaultsDeep({}, settings, DEFAULTS);
		log('debug', `settings: ${JSON.stringify(config.portal.settings, undefined, ' ')}`);
	}

	/**
	 * Create a portal pair.
	 *
	 * This is the higher-level function. It'll automatically select proper source & destination positions
	 * within their respective rooms if the arguments are room names. It's also handling the nuance of core
	 * vs. non-core portals; placing the center wall and the circle of cross-linked portals for the former.
	 */
	async function createPortalPair(
		src: string | RoomPosition,
		dst: string | RoomPosition,
		_opts: Partial<CreatePortalOpts> = {}
	) {
		const defaults: CreatePortalOpts = {
			decayTime: undefined,
			unstableDate: undefined,
			oneWay: false,
			core: false,
		};
		const opts = _.defaults<CreatePortalOpts>({}, _opts, defaults);

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
						makePortal(coreSrc, coreDst, portalOpts);
						if (!opts.oneWay) {
							makePortal(coreDst, coreSrc, portalOpts);
						}
					}
				}
			}
		} else {
			makePortal(srcPos, dstPos, portalOpts);
			if (!opts.oneWay) {
				makePortal(dstPos, srcPos, portalOpts);
			}
		}
	}

	/**
	 * Creates an uni-directional portal between two positions
	 */
	async function makePortal(pos: RoomPosition, destPos: RoomPosition, opts?: PortalOpts) {
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
	}

	/**
	 * Check for and return all portal-forming objects at the given position
	 */
	async function getPortalObjectsAtPos(pos: RoomPosition) {
		const objects = (await db['rooms.objects'].find({
			room: pos.room,
		})) as RoomObject[];

		const portal = objects.find((obj) => obj.type === 'portal' && isSamePos(obj, pos)) as PortalObject;
		if (!portal) {
			return [];
		}

		// We have a portal now *but*… it could be a core portal, so look for a neighboring wall
		const possibleWalls = objects.filter(
			(obj) => obj.type === 'constructedWall' && isInRangeTo(obj, pos, 1) && !('hits' in obj)
		) as WallObject[];
		// No wall -> single portal
		if (!possibleWalls.length) {
			return [portal];
		}

		// Otherwise, check each wall for a 8 ring of portals surrounding it
		const portalObjects: (PortalObject | WallObject)[] = [];
		for (const wall of possibleWalls) {
			const portalRing = objects.filter(
				(obj) => obj.type === 'portal' && isInRangeTo(obj, wall, 1)
			) as PortalObject[];
			if (portalRing.length !== 8) continue;
			portalObjects.push(wall, ...portalRing);
			break;
		}

		return portalObjects;
	}

	async function removePortal(pos: RoomPosition, _opts: RemovePortalOpts = {}) {
		const defaults: RemovePortalOpts = { otherSide: true, dryRun: false };
		const opts = _.defaults<RemovePortalOpts>({}, _opts, defaults);
		if (!isRoomPosition(pos)) {
			throw new Error(
				`Position "${JSON.stringify(pos)}" isn't a valid room position; expected \`{ x, y, room }\``
			);
		}
		const portalObjects = await getPortalObjectsAtPos(pos);
		if (!portalObjects.length) {
			throw new Error(`No portal at position "${JSON.stringify(pos)}"`);
		}

		if (opts.otherSide) {
			const portalPos = (portalObjects.length === 1 ? portalObjects[0] : portalObjects[1]) as PortalObject;
			if (isRoomPosition(portalPos.destination)) {
				const reverseObjects = await getPortalObjectsAtPos(portalPos.destination);
				log('debug', `found ${reverseObjects.length} on the other side:`, reverseObjects[0]);
				portalObjects.push(...reverseObjects);
			} else {
				log('error', `object at the other side has no destination?`);
			}
		}

		// Now remove all of those
		const objectIDs = portalObjects.map((o) => o._id).filter(Boolean);
		if (opts.dryRun) {
			log('info', `would delete ${portalObjects.length} objects:`, portalObjects);
			return;
		}
		log('debug', `deleting ${portalObjects.length} objects:`, portalObjects);
		await db['rooms.objects'].removeWhere({ _id: { $in: objectIDs } });
	}

	config.portal = {
		settings: Object.assign({}, DEFAULTS) as PortalModSettings,
		loadSettings,
		createPortalPair,
		makePortal,
		removePortal,
	};
}

declare global {
	interface ServerConfig {
		portal: {
			settings: PortalModSettings;
			loadSettings(data: any): void;
			createPortalPair(
				src: string | RoomPosition,
				dst: string | RoomPosition,
				opts?: Partial<CreatePortalOpts>
			): Promise<void>;
			makePortal(pos: RoomPosition, destPos: RoomPosition, opts?: PortalOpts): Promise<void>;
			removePortal(pos: RoomPosition, opts?: RemovePortalOpts): Promise<void>;
		};
	}
}
