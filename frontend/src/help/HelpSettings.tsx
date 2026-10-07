import { HelpLink } from './HelpLink';
import { HELP_TOPICS } from './routes';
import './help.css';

export function HelpSettings() {
  return <>
    <div className="settings-section-heading">
      <div><h2>Manual</h2><p>Read the four initial guides.</p></div>
      <HelpLink>Open help index</HelpLink>
    </div>
    <ul className="help-topics">
      {HELP_TOPICS.map(({ slug, title }) => <li key={slug}><HelpLink topic={slug}>{title}</HelpLink></li>)}
    </ul>
  </>;
}
