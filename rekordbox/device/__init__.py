"""Reading rekordbox device (USB) exports: export.pdb, exportExt.pdb, ANLZ.

Parsers are Kaitai-generated from crate-digger's .ksy specs. The specs are
vendored in `ksy/` and the generated code in `generated/`; regenerate with:

    kaitai-struct-compiler -t python --python-package . \
        ksy/rekordbox_pdb.ksy ksy/rekordbox_anlz.ksy

(one-time tool; the generated code is committed so the compiler is not a
build dependency).

This read layer is the independent oracle for the device writer: it must
never share serialization code with writer modules.
"""

from rekordbox.device.anlz_read import read_anlz
from rekordbox.device.pdb_read import read_pdb

__all__ = ["read_anlz", "read_pdb"]
