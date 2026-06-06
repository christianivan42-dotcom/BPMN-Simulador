import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__))))
from app.db.session import init_db
init_db()
print('Base de datos inicializada correctamente.')
