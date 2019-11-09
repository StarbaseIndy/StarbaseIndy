FROM python:3.7-alpine as aws-sam

# RUN apk update && apk upgrade
RUN apk add git npm nodejs
RUN apk add --no-cache --virtual .build-deps build-base \
    && pip3 install --no-cache-dir aws-sam-cli awscli \
    && apk del .build-deps \
    && apk add --no-cache docker-cli

WORKDIR /var/workspace

ENTRYPOINT [ "sam" ]

FROM aws-sam as x11-vnc-ssh
# Configuration here is heavily based on the Dockerfile from:
# https://hub.docker.com/r/rsolano/alpine-vnc
# Unfortunately, it didn't have 'apk', which was needed above.

# default screen size
ENV XRES 1280x800x24

# tzdata settings
ENV TZ_AREA America
ENV TZ_CITY Indianapolis

# main packages
RUN apk add setup-box supervisor nano groff less curl \
    && apk add xvfb x11vnc tzdata \
    && cp /usr/share/zoneinfo/$TZ_AREA/$TZ_CITY /etc/localtime \
    && echo "$TZ_AREA/$TZ_CITY" >  /etc/timezone 

# run setup-box to setup a desktop + xfce4 workstation
# but first, patch setup-box to not asking for new user's passwd
RUN sed -i  's/adduser -h/adduser -D -h/' /sbin/setup-box && echo Y | setup-box -v -d xfce -u alpine

# change root passwd and add users and groups 
# (user alpine alredy added by setup-box)
RUN	echo "root:alpine" | /usr/sbin/chpasswd \
    && echo "alpine:alpine" | /usr/sbin/chpasswd \
    && echo "alpine    ALL=(ALL) ALL" >> /etc/sudoers 

# setup sshd
RUN apk add openssh-server openssh && mkdir /run/sshd && ssh-keygen -A
COPY ./docker/supervisor.conf /etc/supervisord.conf

# exposed ports
EXPOSE 22 5900

ENTRYPOINT ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
