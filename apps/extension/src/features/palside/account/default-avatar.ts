import { createContext } from 'react';
import { avatarPath,defaultAvatarNames,type DefaultAvatarName } from '@palside/shared/person-avatars';

export { defaultAvatar, defaultAvatarNames, teamDefaultAvatars } from '@palside/shared/person-avatars';

const details: Record<DefaultAvatarName, string> = {
  frog: 'extension.copy.frogHat',
  ghost: 'extension.copy.ghostShades',
  cat: 'extension.copy.lazyCat',
  alien: 'extension.copy.calmAlien',
  robot: 'extension.copy.blueRobot',
  duck: 'extension.copy.duckCap',
  hoodie: 'extension.copy.hoodieDumpling',
  dog: 'extension.copy.sportDog',
  mushroom: 'extension.copy.greenMushroom',
  crab: 'extension.copy.angryCrab',
  bat: 'extension.copy.bigEarBat',
  skull: 'extension.copy.flowerSkull',
  cactus: 'extension.copy.bloomingCactus',
  fish: 'extension.copy.surprisedFish',
  star: 'extension.copy.starGlasses',
  pear: 'extension.copy.sneakerPear',
  'three-ears': 'extension.copy.threeEarMonster',
  crown: 'extension.copy.blueCrown',
  sprout: 'extension.copy.flowerMonster',
  'long-nose': 'extension.copy.orangeNose',
  waving: 'extension.copy.purpleWave',
  moustache: 'extension.copy.blueMustache',
  rabbit: 'extension.copy.foldEarRabbit',
  triangle: 'extension.copy.sneakerTriangle',
};
export const defaultAvatarOptions = defaultAvatarNames.map(id => {
  return { id, label: details[id], src: avatarPath(id) };
});

/** Default portraits of the open team's members (teamDefaultAvatars), so two members there never share one; others keep their own. */
export const TeamPortraits = createContext<ReadonlyMap<string, string> | undefined>(undefined);
