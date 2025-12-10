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

  return (
    <div style={{ position: 'relative' }}>
      {isEditing && (
        <>
          {/* Dark overlay */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.5)',
              zIndex: 100,
            }}
          />
          {/* Floating input */}
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '600px',
              maxWidth: '80vw',
              background: 'var(--surface0)',
              border: '2px solid var(--blue)',
              color: 'var(--text)',
              padding: '2px 4px',
              fontFamily: 'inherit',
              fontSize: 'inherit',
              zIndex: 101,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            }}
          />
        </>
      )}
      <div
        onClick={() => setIsEditing(true)}
        style={{
          cursor: 'text',
          padding: '2px 4px',
          border: '1px solid transparent',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          visibility: isEditing ? 'hidden' : 'visible',
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
    </div>
  );
}
