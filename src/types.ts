export type Range = [min: number, max: number];

export type CreatePortalOpts = {
	oneWay?: boolean;
	core?: boolean;
} & ({ unstableDate?: number; decayTime?: undefined } | { unstableDate?: undefined; decayTime?: number | boolean });

export type PortalOpts =
	| { unstableDate?: number; decayTime?: undefined }
	| { unstableDate?: undefined; decayTime?: boolean | number };

export interface PortalModSettings {
	/**
	 * How many portal pairs to maintain on the map.
	 */
	maxPairs: number;
	/**
	 * How close/far apart can a portal pair be.
	 *
	 * First number is the minimum distance; can be `0` to make portals as close as possible.
	 * Second number is the maximum distance; can be `Infinity` to make portals as far as possible.
	 */
	distance: Range;
	/**
	 * Randomness thresholds for various settings.
	 * All those numbers are floats in [0, 1].
	 * Not specifying a number means the chance is effectively 0.
	 */
	chance: {
		/** Random chance that a portal is decaying. */
		decay: number;
		/** Random chance that a portal is unstable. */
		unstable: number;
		/**
		 * Random chance that a portal won't obey the normal rules.
		 *
		 * A stray portal might spawn outside of the core/crossroads rooms.
		 *
		 * @todo Unimplemented
		 */
		stray: number;
		/**
		 * Random chance that a portal is a one-way.
		 *
		 * A one way portal won't have a reverse portal linking back to where it came from.
		 *
		 * @todo Unimplemented
		 */
		oneWay: number;
	};
	/**
	 * The decay value assigned to automatically generated portals.
	 *
	 * Those specify either a value to add, or a range from which a value will be randomly picked.
	 * When the portal is generated, the current tick value will be added to that; hence they're
	 * just the number of ticks a new portal should live for.
	 *
	 * Note that both unstableDate & decayTime cannot be set; portals are either unstable
	 * until a specific date and switch to decay for PORTAL_DECAY ticks after that,
	 * or are just decaying for a number of ticks before disappearing.
	 */
	decayTimeRange: number | Range | undefined;
	/**
	 * The unstable interval assigned to automatically generated portals.
	 *
	 * Those specify either a value to add, or a range from which a value will be randomly picked.
	 * When the portal is generated, the current date value will be added to that; hence they're
	 * just a number of milliseconds a new portal should be stable for.
	 *
	 * Note that both unstableDate & decayTime cannot be set; portals are either unstable
	 * until a specific date and switch to decay for PORTAL_DECAY ticks after that,
	 * or are just decaying for a number of ticks before disappearing.
	 */
	unstableDateRange: number | Range;
}

declare global {
	interface ServerConfig {
		portal: {
			settings: PortalModSettings;
			loadSettings(data: any): void;
			createPortalPair(
				src: string | RoomPosition,
				dst: string | RoomPosition,
				_opts?: Partial<CreatePortalOpts>
			): void;
			makePortal(pos: RoomPosition, destPos: RoomPosition, opts?: PortalOpts): void;
		};
	}

	interface MapCli {
		createPortal(
			_srcRoom: string | RoomPosition,
			_dstRoom: string | RoomPosition,
			_opts: Partial<CreatePortalOpts>
		): Promise<void>;
		removePortal(src: string, dst?: string): Promise<string>;
	}
}
