import os
import sys

# server.py reads its configuration at import time, as it does in the pod.
os.environ.setdefault("WOO_INTERNAL_URL", "http://store-wordpress.store.svc.cluster.local")
os.environ.setdefault("WOO_PUBLIC_URL", "https://store.example.com")
os.environ.setdefault("WOO_CONSUMER_KEY", "ck_test")
os.environ.setdefault("WOO_CONSUMER_SECRET", "cs_test")
os.environ.setdefault("STORE_TIMEZONE", "Asia/Kolkata")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
