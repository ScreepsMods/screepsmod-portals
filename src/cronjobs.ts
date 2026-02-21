import _ from 'lodash';
import { isCore, isCrossroads, isInRangeTo, isSamePos, log, roomType, serverRequire } from './utils';

import type utilsMod from '@screeps/backend/lib/utils.js';
const utils = serverRequire('@screeps/backend/lib/utils.js') as typeof utilsMod;
import type commonMod from '@screeps/common';
import { CreatePortalOpts } from './types';
import { ServerConfig, PortalObject, Room, StructureWallObject } from 'typed-screeps-server';

const common = serverRequire('@screeps/common') as typeof commonMod;

export default function (config: ServerConfig) {
	config.cronjobs.refreshPortals = [300, () => refreshPortals(config)];
}

async function refreshPortals(config: ServerConfig) {
	const { db } = config.common.storage;
	const {
		maxPairs,
		distance: [minDistance, maxDistance],
		chance,
		unstableDateRange,
		decayTimeRange,
	} = config.portal.settings;

	log('info', `Refreshing portals`);

	// We make a list of all the portals we know about
	const oneWay = new Set<PortalObject>();
	const pairs = new Map<PortalObject, PortalObject>();
	const portals = (await db['rooms.objects'].find({ type: 'portal' })) as PortalObject[];
	const corePortals = new Set<PortalObject>();
	for (const portal of portals) {
		const pair = portals.find((p) => isSamePos(p, portal.destination));
		const roomPortals = portals.filter((p) => p.room === portal.room);

		// Core portal detection
		if (corePortals.has(portal)) {
			continue;
		}

		const walls = (await db['rooms.objects'].find({
			type: 'constructedWall',
			room: portal.room,
		})) as StructureWallObject[];
		if (walls.length && roomPortals.length) {
			const closePortals = roomPortals.filter((p) => walls.some((w) => isInRangeTo(p, w, 1)));
			if (closePortals.length === 8) {
				closePortals.forEach((p) => corePortals.add(p));
			}
		}

		if (pair) {
			pairs.set(portal, pair);
			pairs.set(pair, portal);
		} else {
			oneWay.add(portal);
		}
	}

	let numPairs = pairs.size / 2 + oneWay.size;

	log(
		'debug',
		`${pairs.size / 2} portal pairs: ${[...pairs.entries()].map(([p1, p2]) => `${p1.room} => ${p2.room}`)}`
	);
	log(
		'debug',
		`${oneWay.size} one-way portals: ${[...oneWay.values()].map((p) => `${p.room} => ${p.destination.room}`)}`
	);

	const allRooms = (await db['rooms'].find({ status: 'normal' })) as Room[];

	const possibleRooms = new Set(allRooms.filter((r) => isCore(r) || isCrossroads(r)));
	log('debug', `portalRooms: ${[...possibleRooms.values()].map((r) => r.name)}`);

	let limit = 10;
	while (numPairs < maxPairs && limit > 0) {
		log('debug', `missing ${maxPairs - numPairs}`);
		const isStray = chance.stray !== 0 && Math.random() <= chance.stray;
		let portalRooms = isStray ? allRooms : [...possibleRooms];
		const srcRoom = _.sample(portalRooms);
		if (!srcRoom) break;
		possibleRooms.delete(srcRoom);
		if (!isStray) {
			portalRooms = [...possibleRooms];
		}
		const portalsInRoom = (await db['rooms.objects'].find({
			room: srcRoom.name,
			type: 'portal',
		})) as PortalObject[];
		if (isCore(srcRoom) && portalsInRoom.length > 0) {
			// We don't allow multiple portals in a core room
			limit--;
			continue;
		}

		// Helper function to select a proper destination
		const pickRandomDestination = (room: Room) => {
			const [roomX, roomY] = utils.roomNameToXY(room.name);
			log(
				'debug',
				`picked ${isStray ? 'stray ' : ''}room ${room.name} (${roomX}, ${roomY}), checking rooms in range ${minDistance}-${maxDistance}`
			);
			const candidates = portalRooms.filter((r) => {
				if (r.status !== room.status) return false;
				if (!isStray && roomType(r) !== roomType(room)) return false;
				if (portalsInRoom.find((p) => p.destination.room === r.name)) {
					log('debug', `portal between ${srcRoom.name} and ${r.name} already exist, ignoring`);
					// There's already a portal linking back to this room, skip!
					return false;
				}
				const [rX, rY] = utils.roomNameToXY(r.name);
				const [xDist, yDist] = [Math.abs(roomX - rX), Math.abs(roomY - rY)];
				const valid =
					xDist >= minDistance && yDist >= minDistance && xDist < maxDistance && yDist < maxDistance;
				log('debug', `checking ${r.name} (${rX}, ${rY}): ${xDist}, ${yDist} => ${valid}`);
				return valid;
			});
			return _.sample(candidates);
		};

		const dstRoom = pickRandomDestination(srcRoom);
		if (!dstRoom) {
			log('debug', `no good destination room for ${srcRoom.name}`);
			limit--;
			continue;
		}
		log('debug', `selected destination rooms for ${srcRoom.name}: ${dstRoom.name}`);
		possibleRooms.delete(dstRoom);

		const opts: CreatePortalOpts = { core: isCore(srcRoom) };
		if (chance.oneWay !== 0 && Math.random() <= chance.oneWay) {
			opts.oneWay = true;
		}
		if (chance.unstable !== 0 && Math.random() <= chance.unstable) {
			if (_.isNumber(unstableDateRange)) {
				opts.unstableDate = Date.now() + unstableDateRange;
			} else {
				opts.unstableDate = Date.now() + _.random(...unstableDateRange);
			}
		} else if (chance.decay !== 0 && Math.random() <= chance.decay) {
			if (_.isNumber(decayTimeRange)) {
				opts.decayTime = decayTimeRange;
			} else if (decayTimeRange === undefined) {
				opts.decayTime = true;
			} else {
				opts.decayTime = _.random(...decayTimeRange);
			}
		}

		await config.portal.createPortalPair(srcRoom.name, dstRoom.name, opts);

		numPairs++;
		limit--;
	}
}
