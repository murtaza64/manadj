import './TagPill.css';
import type { Tag } from '../types';
import { getTagColor } from '../utils/colorUtils';

interface Props {
  tag: Tag;
}

export default function TagPill({ tag }: Props) {
  const color = getTagColor(tag);

  return (
    <span
      className="tag-pill"
      style={{
        color: color
      }}
    >
      {tag.name}
    </span>
  );
}
