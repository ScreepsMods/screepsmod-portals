import _ from 'lodash';
import { serverRequire } from './utils';

import type utilsMod from '@screeps/backend/lib/utils.js';
import { CreatePortalOpts } from './types';

const utils = serverRequire('@screeps/backend/lib/utils.js') as typeof utilsMod;
// const engineUtils = serverRequire('@screeps/engine/src/utils.js');

export default function (config: ServerConfig, sandbox: CliSandbox) {
	sandbox.map.createPortal = utils.withHelp([
		'createPortal(srcRoom, dstRoom, [opts]) - Create a portal between two rooms (or positions).\n' +
			"    'opts' is an object with the following optional properties:\n" +
			'    * decayTime - number of ticks before the portal decays and disappears, or true if you want the default decaying duration\n' +
			'    * unstableDate - a timestamp of when the portal should start decaying\n' +
			'    * oneWay - create only one portal from source to dest\n' +
			'    * core - create an 3x3 rings of portals around a constructed wall (the position is in the center)',
		async function (src: string | RoomPosition, dst: string | RoomPosition, opts?: Partial<CreatePortalOpts>) {
			config.portal.createPortalPair(src, dst, opts);
		},
	]);

	// Regenerate the help message to show our new commands
	sandbox.map._help = utils.generateCliHelp('map.', sandbox.map);
}
