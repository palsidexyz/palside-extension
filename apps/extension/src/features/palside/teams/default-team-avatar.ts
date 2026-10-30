import { defaultTeamAvatarNames,teamAvatarPath,type DefaultTeamAvatarName } from '@palside/shared/team-avatars';

export { defaultTeamAvatar, defaultTeamAvatarNames } from '@palside/shared/team-avatars';

const details: Record<DefaultTeamAvatarName, string> = {
  'frog-ghost': 'extension.copy.frogGhost',
  'robot-duo': 'extension.copy.robotDuo',
  'cat-duo': 'extension.copy.catDuo',
  'blob-trio': 'extension.copy.dumplingTrio',
  'mushroom-pals': 'extension.copy.mushroomUmbrella',
  'cool-birds': 'extension.copy.sunglassesDuo',
  'ghost-high-five': 'extension.copy.ghostHighfive',
  'monster-stack': 'extension.copy.monsterStack',
  'portrait-classics': 'extension.copy.teamPortraitClassics',
  'portrait-cosmic': 'extension.copy.teamPortraitCosmic',
  'portrait-cozy': 'extension.copy.teamPortraitCozy',
  'portrait-nature': 'extension.copy.teamPortraitNature',
  'portrait-playful': 'extension.copy.teamPortraitPlayful',
  'portrait-mischief': 'extension.copy.teamPortraitMischief',
  'chat-classics': 'extension.copy.teamChatClassics',
  'chat-cosmic': 'extension.copy.teamChatCosmic',
  'chat-cozy': 'extension.copy.teamChatCozy',
  'chat-night': 'extension.copy.teamChatNight',
  'chat-odd': 'extension.copy.teamChatOdd',
  'chat-garden': 'extension.copy.teamChatGarden',
  'ride-boat': 'extension.copy.teamRideBoat',
  'ride-spaceship': 'extension.copy.teamRideSpaceship',
  'ride-camper': 'extension.copy.teamRideCamper',
  'ride-skateboard': 'extension.copy.teamRideSkateboard',
};
export const defaultTeamAvatarOptions = defaultTeamAvatarNames.map(id => {
  return { id, label: details[id], src: teamAvatarPath(id) };
});
