import _ from 'lodash';
import path from 'path';

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
}

export function roomType(room: Room | RoomName) {
	const name = _.isString(room) ? room : room.name;
	if (isCore(name)) return RoomType.CORE;
	else if (isCrossroads(name)) return RoomType.CROSSROADS;
	// TODO: incomplete
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

/**
 *
 * @param {string} terrain
 * @returns
 */
export function decodeTerrain(terrain: string) {
	return terrain.split('').map((char) => Number(char));
}

export function checkTerrain(terrain: number[], x: number, y: number, mask: number) {
	if (x < 0 || x > 49) throw new Error(`x coordinate out of terrain bounds: ${x}`);
	if (y < 0 || y > 49) throw new Error(`y coordinate out of terrain bounds: ${y}`);
	const code = terrain[y * 50 + x];
	return (code & mask) > 0;
}
