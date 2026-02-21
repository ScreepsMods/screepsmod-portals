import _ from 'lodash';
import path from 'path';
import { Range } from './types';
import { RoomName, RoomPosition, Room } from 'typed-screeps-server';

const serverModulesDir = path.resolve(process.cwd(), 'node_modules');

export function serverRequire(id: string) {
	return require(require.resolve(id, { paths: [serverModulesDir] }));
}

export function log(level: 'info' | 'debug' | 'error', ...args: any[]) {
	console[level]('[portals]', ...args);
}

export function isRoomName(roomName: unknown): roomName is RoomName {
	return typeof roomName === 'string' && /^[WE]\d+[NS]\d+$/.test(roomName);
}

export function isRoomPosition(obj: unknown): obj is RoomPosition {
	if (
		typeof obj !== 'object' ||
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
		obj.y > 49
	) {
		return false;
	}
	return true;
}

export function printPos(pos: RoomPosition) {
	return JSON.stringify(pos);
}

export function isSamePos(pos1: RoomPosition, pos2: RoomPosition) {
	return pos1.x === pos2.x && pos1.y === pos2.y && pos1.room === pos2.room;
}

export function isInRangeTo(pos1: RoomPosition, pos2: RoomPosition, range: number) {
	return (
		pos1.room === pos2.room &&
		_.inRange(pos1.x, pos2.x - range, pos2.x + range + 1) &&
		_.inRange(pos1.y, pos2.y - range, pos2.y + range + 1)
	);
}

export enum RoomType {
	NORMAL = 'normal',
	CORE = 'core',
	CROSSROADS = 'crossroads',
	HIGHWAY = 'highway',
}

export function roomType(room: Room | RoomName) {
	const name = _.isString(room) ? room : room.name;
	if (isCore(name)) return RoomType.CORE;
	else if (isCrossroads(name)) return RoomType.CROSSROADS;
	else if (isHighway(name)) return RoomType.HIGHWAY;
	return RoomType.NORMAL;
}

export function isCrossroads(room: Room | RoomName) {
	const name = _.isString(room) ? room : room.name;
	return !!name.match(/[EW]\d*0[NS]\d*0/);
}

export function isCore(room: Room | RoomName) {
	const name = _.isString(room) ? room : room.name;
	return !!name.match(/[EW]\d*5[NS]\d*5/);
}

export function isHighway(room: Room | RoomName) {
	const name = _.isString(room) ? room : room.name;
	return !!name.match(/[EW]\d*0[NS]\d*|[EW]\d*[NS]\d*0/);
}

/**
 * Check whether {@link r} represents a range.
 *
 * @param r The range to check
 * @param minValue The expected lower bound of the range
 * @param maxValue The expected upper bound of the range
 */
export function isRange(r: unknown, minValue?: number, maxValue?: number): r is Range {
	return (
		Array.isArray(r) &&
		r.length === 2 &&
		r.every(
			(n) =>
				typeof n === 'number' && (minValue === undefined || n >= 0) && (maxValue === undefined || n <= maxValue)
		) &&
		(r[0] as number) < (r[1] as number)
	);
}

/**
 * Check whether a number lies within [min, max]
 */
export function isNumberBetween(n: number, min: number, max: number) {
	return n >= min && n <= max;
}
