"""Run directly in macOS Terminal. Hidden prompts, private local file, no network."""
from pathlib import Path
import getpass
import json
import os
import stat
import sys
import tempfile
import warnings

class SafeError(Exception):pass

def save(home,access,secret):
    if not access or not secret or len(access)>256 or len(secret)>4096 or any(c.isspace() for c in access+secret):
        raise SafeError('credential_format_rejected')
    home=Path(home)
    hs=home.lstat()
    if not stat.S_ISDIR(hs.st_mode) or stat.S_ISLNK(hs.st_mode) or hs.st_uid!=os.getuid():raise SafeError('unsafe_home_directory')
    # Existing ancestors must be real directories, never symlink shortcuts.
    base=home
    for name in ('.config','manadj-r2'):
        base=base/name
        try:base.mkdir(mode=0o700)
        except FileExistsError:pass
        s=base.lstat()
        if not stat.S_ISDIR(s.st_mode) or stat.S_ISLNK(s.st_mode) or s.st_uid!=os.getuid():raise SafeError('unsafe_config_directory')
        if name=='.config' and s.st_mode&0o022:raise SafeError('unsafe_parent_permissions')
        if name=='manadj-r2' and s.st_mode&0o077:raise SafeError('config_directory_not_private')
    target=base/'credentials.json'
    if target.exists() or target.is_symlink():raise SafeError('credentials_already_exist')
    body=json.dumps({'endpoint':'https://a4f837dfdb11165a1c1cbbf676db0684.r2.cloudflarestorage.com',
        'bucket':'manadj-original-audio','access_key_id':access,'secret_access_key':secret},separators=(',',':')).encode()
    fd,temp=tempfile.mkstemp(prefix='.credentials-',dir=base)
    try:
        with os.fdopen(fd,'wb') as f:f.write(body);f.flush();os.fsync(f.fileno())
        os.link(temp,target) # Atomic no overwrite.
    finally:os.unlink(temp)
    return target


def main():
    if not sys.stdin.isatty() or not sys.stdout.isatty() or not sys.stderr.isatty():
        print('Run directly in your own Terminal, not a chat or agent command runner.');return 2
    try:
        print('Private local R2 credential capture. Nothing is uploaded. Inputs are hidden.')
        print('Create only the bucket-scoped Object Read & Write key for manadj-original-audio.')
        with warnings.catch_warnings():
            warnings.simplefilter('error',getpass.GetPassWarning)
            access=getpass.getpass('Access Key ID (hidden): ')
            secret=getpass.getpass('Secret Access Key (hidden): ')
            confirm=getpass.getpass('Secret Access Key again (hidden): ')
        if secret!=confirm:raise SafeError('secret_confirmation_mismatch')
        save(Path.home(),access,secret)
        print('Saved privately in ~/.config/manadj-r2/credentials.json (0600). No upload started.')
        return 0
    except (KeyboardInterrupt,EOFError):print('Cancelled. No upload started.');return 2
    except SafeError as e:print('Stopped: '+str(e));return 2
    except Exception:print('Stopped: local_save_failed. No upload started.');return 2
if __name__=='__main__':raise SystemExit(main())
