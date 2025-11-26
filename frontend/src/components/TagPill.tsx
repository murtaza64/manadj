import './TagPill.css';
import type { Tag } from '../types';

interface Props {
  tag: Tag;
}

export default function TagPill({ tag }: Props) {
  const borderColor = tag.category.color || 'var(--surface0)';

  return (
    <span
      className="tag-pill"
      style={{
        background: 'transparent',
        border: `1px solid ${borderColor}`
      }}
    >
      {tag.name}
    </span>
  );
}
