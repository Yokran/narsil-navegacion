"""Logger mínimo del nodo."""
from __future__ import annotations

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-5s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)

_log = logging.getLogger("narsil")


class Logger:
    def info(self, msg: str) -> None:
        _log.info(msg)

    def warn(self, msg: str) -> None:
        _log.warning(msg)

    def error(self, msg: str) -> None:
        _log.error(msg)


logger = Logger()
