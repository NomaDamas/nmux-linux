# Smoke-test environment for nmux-linux: clean Ubuntu + only the
# install.sh-managed tooling. Used by test/smoke.sh.

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -y && apt-get install -y --no-install-recommends \
        bash ca-certificates curl git sudo \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash tester \
    && echo 'tester ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

USER tester
WORKDIR /home/tester

# Project source is copied in by smoke.sh at build time.
COPY --chown=tester:tester . /home/tester/nmux-linux/

CMD ["/bin/bash", "-lc", "/home/tester/nmux-linux/test/smoke.sh"]
