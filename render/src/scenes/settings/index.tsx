/** Setting registry: background (behind characters), optional foreground, ground line. */
import type React from "react";
import type { Ctx } from "../ctx";
import type { SettingId } from "../parse";
import { CityBack, cityGround } from "./city";
import { HospitalBack, HospitalFront, LabBack, PowerBack, PowerFront } from "./interior";
import { ForestBack, ForestFront, forestGround, IceBack, IceFront, MeadowBack, MeadowFront, MountainsBack, SavannaBack, SavannaFront, savannaGround, SkyBack, SkyFront } from "./nature";
import { OceanBack, OceanFront, SpaceBack, UnderwaterBack, UnderwaterFront } from "./water";

export type SettingDef = {
  Back: React.FC<{ ctx: Ctx }>;
  Front?: React.FC<{ ctx: Ctx }>;
  /** Ground / water line (world units) where characters stand. */
  ground: (VH: number) => number;
  /** Keep the sun/moon above this fraction of the frame height (so scenery doesn't hide it). */
  orbMaxY?: number;
};

export const SETTING_DEFS: Record<SettingId, SettingDef> = {
  city: { Back: ({ ctx }) => <CityBack ctx={ctx} />, ground: (VH) => cityGround(VH), orbMaxY: 0.3 },
  rooftops: { Back: ({ ctx }) => <CityBack ctx={ctx} rooftops />, ground: (VH) => cityGround(VH, true), orbMaxY: 0.32 },
  forest: { Back: ForestBack, Front: ForestFront, ground: forestGround, orbMaxY: 0.3 },
  savanna: { Back: SavannaBack, Front: SavannaFront, ground: savannaGround, orbMaxY: 0.66 },
  meadow: { Back: MeadowBack, Front: MeadowFront, ground: (VH) => VH * 0.84, orbMaxY: 0.4 },
  mountains: { Back: MountainsBack, ground: (VH) => VH * 0.94, orbMaxY: 0.3 },
  ice: { Back: IceBack, Front: IceFront, ground: (VH) => VH * 0.86, orbMaxY: 0.45 },
  ocean: { Back: OceanBack, Front: OceanFront, ground: (VH) => VH * 0.8, orbMaxY: 0.42 },
  underwater: { Back: UnderwaterBack, Front: UnderwaterFront, ground: (VH) => VH * 0.55 },
  sky: { Back: SkyBack, Front: SkyFront, ground: (VH) => VH * 0.6, orbMaxY: 0.5 },
  space: { Back: SpaceBack, ground: (VH) => VH * 0.88 },
  hospital: { Back: HospitalBack, Front: HospitalFront, ground: (VH) => VH * 0.9 },
  lab: { Back: LabBack, ground: (VH) => VH * 0.92 },
  power: { Back: PowerBack, Front: PowerFront, ground: (VH) => VH * 0.86 },
};
