import { ServerConfig } from 'typed-screeps-server';
import backend from './backend';
import common from './common';

export default function (config: ServerConfig) {
	common(config);
	if (config.backend) backend(config);
}
