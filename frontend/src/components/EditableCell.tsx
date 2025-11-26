import { useState, useEffect, useRef } from 'react';

interface EditableCellProps {
  value: string;
  onSave: (newValue: string) => void;
  placeholder?: string;
}

export default function EditableCell({ value, onSave, placeholder }: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (editValue !== value) {
      onSave(editValue);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{
          width: '100%',
          background: 'var(--surface0)',
          border: '1px solid var(--surface1)',
          color: 'var(--text)',
          padding: '2px 4px',
          fontFamily: 'inherit',
          fontSize: 'inherit',
        }}
      />
    );
  }

  return (
    <div
      onClick={() => setIsEditing(true)}
      style={{
        cursor: 'text',
        padding: '2px 4px',
        border: '1px solid transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.border = '1px solid var(--surface1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.border = '1px solid transparent';
      }}
    >
      {value || <span style={{ color: 'var(--overlay0)' }}>{placeholder || '-'}</span>}
    </div>
  );
}
