import { useState, useRef, useEffect } from 'react';

interface BpmInputProps {
  value: number | null;
  recommendedBpms?: number[];
  onChange: (bpm: number) => void;
  disabled?: boolean;
}

// CSS to hide number input spinners
const inputStyle = document.createElement('style');
inputStyle.textContent = `
  input[type="number"].bpm-input::-webkit-outer-spin-button,
  input[type="number"].bpm-input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
`;
if (!document.head.querySelector('style[data-bpm-input]')) {
  inputStyle.setAttribute('data-bpm-input', '');
  document.head.appendChild(inputStyle);
}

export default function BpmInput({ value, recommendedBpms, onChange, disabled }: BpmInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
  const [inputValue, setInputValue] = useState(value?.toString() ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync input value when prop changes
  useEffect(() => {
    if (!isFocused) {
      setInputValue(value?.toString() ?? '');
    }
  }, [value, isFocused]);

  // Calculate octave options based on current BPM
  const octaveOptions = value ? [
    { bpm: Math.round(value * 2), label: '×2' },
    { bpm: Math.round(value * 1.5), label: '×3/2' },
    { bpm: Math.round(value * (2/3)), label: '×2/3' },
    { bpm: Math.round(value / 2), label: '×1/2' },
  ] : [];

  // Combine recommended BPMs and octave options, removing duplicates
  const allOptions = [...(recommendedBpms || []), ...octaveOptions.map(o => o.bpm)];
  const uniqueOptions = Array.from(new Set(allOptions)).sort((a, b) => b - a);

  // Create display items with labels
  const displayItems = uniqueOptions.map(bpm => {
    const octave = octaveOptions.find(o => o.bpm === bpm);
    const isRecommended = recommendedBpms?.includes(bpm);

    let label = `${bpm} BPM`;
    if (octave && isRecommended) {
      label = `${bpm} BPM (${octave.label})`;
    } else if (octave) {
      label = `${bpm} BPM (${octave.label})`;
    }

    return { bpm, label, isRecommended: !!isRecommended, isOctave: !!octave };
  });

  const showDropdown = isFocused && (value !== null || (recommendedBpms && recommendedBpms.length > 0));

  // Update dropdown position when showing and reset selection
  useEffect(() => {
    if (showDropdown && inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + 2,
        left: rect.left
      });
      setSelectedIndex(-1); // No item selected by default
    }
  }, [showDropdown]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsFocused(false);
      inputRef.current?.blur();
      return;
    }

    if (!showDropdown || displayItems.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev =>
        prev < displayItems.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0) {
        const selectedBpm = displayItems[selectedIndex].bpm;
        setInputValue(selectedBpm.toString());
        onChange(selectedBpm);
      } else {
        // If nothing selected, just commit the current input value
        const val = parseFloat(inputValue);
        if (!isNaN(val)) {
          onChange(val);
        }
      }
      setIsFocused(false);
      inputRef.current?.blur();
    }
  };

  const handleSelect = (bpm: number) => {
    setInputValue(bpm.toString());
    onChange(bpm);
    setIsFocused(false);
    inputRef.current?.blur();
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        className="bpm-input"
        value={inputValue}
        onChange={(e) => {
          const newValue = e.target.value;

          // Allow empty string for clearing
          if (newValue === '') {
            setInputValue('');
            return;
          }

          // Only allow valid number input (including partial like "174.")
          if (newValue.match(/^\d*\.?\d*$/)) {
            setInputValue(newValue);

            // Only call onChange if it's a complete valid number
            const val = parseFloat(newValue);
            if (!isNaN(val) && newValue !== '' && !newValue.endsWith('.')) {
              onChange(val);
            }
          }
        }}
        onFocus={() => {
          setIsFocused(true);
          // Select all text on focus for easy editing
          inputRef.current?.select();
        }}
        onBlur={() => {
          // Only commit if the input value is different from display
          const val = parseFloat(inputValue);
          if (!isNaN(val) && val !== value) {
            onChange(val);
          } else if (inputValue === '') {
            // Allow clearing - keep it empty
          } else if (isNaN(val) && inputValue !== '') {
            // Invalid input - revert to original value
            setInputValue(value?.toString() ?? '');
          }

          // Small delay to allow dropdown clicks to register
          setTimeout(() => setIsFocused(false), 150);
        }}
        onKeyDown={handleKeyDown}
        onMouseEnter={(e) => {
          if (!isFocused) {
            e.currentTarget.style.border = '1px solid var(--surface1)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isFocused) {
            e.currentTarget.style.border = '1px solid transparent';
          }
        }}
        disabled={disabled}
        placeholder="-"
        style={{
          width: '50px',
          padding: '2px 4px',
          background: isFocused ? 'var(--surface0)' : 'transparent',
          border: `1px solid ${isFocused ? 'var(--lavender)' : 'transparent'}`,
          color: 'var(--text)',
          fontSize: '12px',
          fontFamily: 'UbuntuMono Nerd Font, monospace',
          outline: 'none',
          cursor: 'text',
        }}
      />

      {showDropdown && displayItems.length > 0 && (
        <div
          ref={dropdownRef}
          style={{
            position: 'fixed',
            top: `${dropdownPosition.top}px`,
            left: `${dropdownPosition.left}px`,
            background: 'var(--mantle)',
            border: '1px solid var(--lavender)',
            borderRadius: '0px',
            zIndex: 1000,
            minWidth: '140px',
            maxHeight: '250px',
            overflowY: 'auto',
          }}
        >
          {displayItems.map((item, index) => (
            <div
              key={item.bpm}
              onClick={() => handleSelect(item.bpm)}
              onMouseEnter={() => setSelectedIndex(index)}
              style={{
                padding: '4px 8px',
                cursor: 'pointer',
                background: selectedIndex === index ? 'var(--surface0)' : 'transparent',
                color: item.bpm === value ? 'var(--green)' : item.isRecommended ? 'var(--blue)' : 'var(--text)',
                fontSize: '12px',
                fontFamily: 'UbuntuMono Nerd Font, monospace',
                fontWeight: item.bpm === value ? 'bold' : 'normal',
              }}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
