# The read path only. Data preparation and trials need the lake and far more
# memory than a web container has; this image serves finished runs and, once
# the compute backend exists, hands submissions to it.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.lock.txt .
RUN pip install --no-cache-dir -r requirements.lock.txt

COPY sharpeluck/ sharpeluck/
COPY api/ api/

# Seed results: the artefacts the frontend actually fetches, a few hundred KB a
# run. The 650 MB panel each run also writes is a working file nobody reads.
COPY results/ /srv/runs/

# No Slurm here, and the store lives outside the (absent) data lake.
ENV SHARPELUCK_RUNS_ROOT=/srv/runs \
    SHARPELUCK_BACKEND=local \
    PYTHONUNBUFFERED=1

RUN useradd --create-home app && chown -R app /srv/runs
USER app

EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
