"""Logging configuration with colored output."""

import logging
import sys


class ANSICOLORS:
    """ANSI color codes for terminal formatting."""

    # Basic colors
    BLACK = "\033[30m"
    RED = "\033[31m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    WHITE = "\033[37m"

    # Bright colors
    BRIGHT_BLACK = "\033[90m"
    BRIGHT_RED = "\033[91m"
    BRIGHT_GREEN = "\033[92m"
    BRIGHT_YELLOW = "\033[93m"
    BRIGHT_BLUE = "\033[94m"
    BRIGHT_MAGENTA = "\033[95m"
    BRIGHT_CYAN = "\033[96m"
    BRIGHT_WHITE = "\033[97m"

    # RGB Grey
    GREY = "\033[38;2;128;128;128m"

    # Formatting
    BOLD = "\033[1m"
    DIM = "\033[2m"
    UNDERLINE = "\033[4m"
    RESET = "\033[0m"


class ColoredFormatter(logging.Formatter):
    """Formatter with colored output for different log levels."""

    # Log level color mapping
    COLORS = {
        "DEBUG": ANSICOLORS.CYAN,
        "INFO": ANSICOLORS.BLUE,
        "WARNING": ANSICOLORS.YELLOW,
        "ERROR": ANSICOLORS.RED,
        "CRITICAL": ANSICOLORS.MAGENTA,
        "RESET": ANSICOLORS.RESET,
    }

    def __init__(self, *args, use_colors=True, **kwargs):
        super().__init__(*args, **kwargs)
        self.use_colors = use_colors

    def apply_color(self, text: str, color: str) -> str:
        """Apply color if colors are enabled, otherwise return plain text."""
        if self.use_colors:
            color_code = getattr(ANSICOLORS, color, self.COLORS.get(color, ANSICOLORS.RESET))
            return f"{color_code}{text}{ANSICOLORS.RESET}"
        return text

    def format(self, record):
        # Format timestamp
        timestamp = self.formatTime(record, self.datefmt)
        grey_timestamp = self.apply_color(f"[{timestamp}]", "GREY")

        # Format colored level
        level_name = record.levelname
        colored_level = self.apply_color(level_name[0], level_name)

        # Build base log message
        logger_name = self.apply_color(f"[{record.name}]", level_name)
        parts = [grey_timestamp, f"[{colored_level}]", logger_name]

        # Add the actual message
        parts.append(record.getMessage())

        # Handle exceptions
        log_message = " ".join(parts)
        if record.exc_info and (not record.exc_text or isinstance(record.exc_text, bool)):
            record.exc_text = self.formatException(record.exc_info)
        if record.exc_text and isinstance(record.exc_text, str):
            if log_message[-1:] != "\n":
                log_message = log_message + "\n"
            log_message = log_message + record.exc_text

        return log_message


def setup_logging():
    """Setup colored logging for the application and override uvicorn's loggers."""

    # Create colored formatter
    log_format = "[%(asctime)s] [%(levelname).1s] [%(name)s] %(message)s"
    date_format = "%H:%M:%S"
    colored_formatter = ColoredFormatter(log_format, datefmt=date_format, use_colors=True)

    # Configure root logger
    logging.root.handlers.clear()
    logging.root.setLevel(logging.INFO)

    # Add console handler to root
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(colored_formatter)
    console_handler.setLevel(logging.INFO)
    logging.root.addHandler(console_handler)

    # Override uvicorn's loggers to use our formatter
    # See: https://github.com/fastapi/fastapi/discussions/7457
    for logger_name in ["uvicorn", "uvicorn.access", "uvicorn.error"]:
        logger = logging.getLogger(logger_name)
        logger.handlers.clear()
        logger.propagate = True  # Let it propagate to root logger with our formatter

    # Make sure our backend loggers use the root configuration
    backend_logger = logging.getLogger("backend")
    backend_logger.propagate = True
