import argparse
import json
import logging
import signal
import sqlite3
import threading

from .client import Client, Config, FatalTransport, read_json
from .contracts import InvalidPayload
from .outbox import Outbox


def main():
    parser = argparse.ArgumentParser(description="QNX durable device event transport")
    parser.add_argument("--config", required=True, help="Device JSON configuration (no token in argv)")
    parser.add_argument("--allow-local-ws", action="store_true", help="Allow plain WS only to loopback for isolated tests")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("run", help="Continuously deliver queued episodes and health")
    enqueue = commands.add_parser("enqueue", help="Persist one already-grouped inference event")
    enqueue.add_argument("--event-file", required=True)
    commands.add_parser("status", help="Show queue counts without payloads or credentials")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        config = Config.load(args.config, allow_local_ws=args.allow_local_ws)
        if args.command == "run":
            stop = threading.Event()
            for signum in (signal.SIGINT, signal.SIGTERM):
                signal.signal(signum, lambda *_: stop.set())
            Client(config).run(stop)
        else:
            outbox = Outbox(config.outbox_path, config.device_id, config.room_id)
            try:
                if args.command == "enqueue":
                    outbox.enqueue(read_json(args.event_file))
                print(json.dumps(outbox.stats()))
            finally:
                outbox.close()
        return 0
    except (InvalidPayload, FatalTransport) as error:
        logging.error("%s", error)
        return 2
    except (OSError, sqlite3.Error, ValueError):
        logging.error("Local configuration/storage failure; inspect file paths, permissions and free space")
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
