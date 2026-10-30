import { PalsideApp as Panel } from '../src/features/palside/app/palside-app';
import type { PalsideProps } from '../src/features/palside/app/panel-props';
import { useMemoryData } from '../src/features/palside/app/memory-data';
import { createMemoryActions } from '../src/features/palside/app/memory-actions';

export function PalsideApp(props: PalsideProps) {
  return props.live ? <Panel {...props} /> : <PreviewPanel key={props.data.self} {...props} />;
}

function PreviewPanel(props: PalsideProps) {
  const initialTeam = props.data.teams[0] ?? { id: '', name: '', description: '', owner: '', memberIds: [], joined: false, published: false, muted: false, unread: 0 };
  const data = useMemoryData({ data: props.data, scenario: props.scenario ?? 'normal', initialTeam });
  return <Panel {...props} adapter={{ data, actions: createMemoryActions }} />;
}
