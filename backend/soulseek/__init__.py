"""Managed slskd (setup-guides #291): manadj supervises a bundled, unmodified
slskd binary (AGPL-3.0, separate process) so the Soulseek Supplier works
without the user standing up a daemon. See managed.py (paths, stored
credentials, generated slskd config) and supervisor.py (process lifecycle).
"""
