import cli from './cli';
import cronjobs from './cronjobs';
import { log } from './utils';

export default function (config: ServerConfig) {
	cronjobs(config);

	config.utils?.on('config:update:portals', (data) => {
		log('info', 'portals config reload!', data);
		config.portal.loadSettings(data);
	});
	config.cli.on('cliSandbox', function (sandbox: CliSandbox) {
		cli(config, sandbox);
	});
}
