/**
 * The shipped Mappings, one entry per supported Controller model. The
 * Controller layer (MidiControllerBridge) attaches all of them; the
 * Controller check guide uses the model names for "Mapping present?".
 */
import type { Mapping } from '../mapping';
import { INPULSE_300_MK2 } from './inpulse300mk2';
import { DDJ_GRV6 } from './ddjGrv6';
import { DDJ_SB3 } from './ddjSb3';

export interface ControllerModel {
  /** Display name of the hardware model. */
  name: string;
  mapping: Mapping;
}

export const CONTROLLER_MODELS: readonly ControllerModel[] = [
  { name: 'Hercules DJControl Inpulse 300 MK2', mapping: INPULSE_300_MK2 },
  { name: 'AlphaTheta DDJ-GRV6', mapping: DDJ_GRV6 },
  { name: 'Pioneer DJ DDJ-SB3', mapping: DDJ_SB3 },
];

export const MAPPINGS: readonly Mapping[] = CONTROLLER_MODELS.map((m) => m.mapping);
