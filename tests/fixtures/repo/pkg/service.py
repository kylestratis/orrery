from .base import Base
from . import helpers
import os


class Service(Base):
    def run(self):
        return helpers.helper()


class Worker:
    def go(self):
        return Service()
