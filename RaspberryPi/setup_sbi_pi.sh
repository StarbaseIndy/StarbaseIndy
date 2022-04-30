#!/bin/bash

# Note: This script is intended to be run on a Raspian image, circa 2020
# Download that from here: http://downloads.raspberrypi.org/raspbian/images/raspbian-2020-02-14/

# Install mplayer
sudo apt-get -y --allow-releaseinfo-change update
sudo apt-get -y upgrade
sudo apt-get -y dist-upgrade
sudo apt-get -y install handbrake
#sudo apt-get -y install mplayer

# Copy all of the video files
cp ./Videos/* /home/pi/Videos

mkdir /home/pi/Videos-H.264
cp ./Videos-H.264/* /home/pi/Videos-H.264

# Copy the video looper script
cp ./playvideo.sh /home/pi
chmod +x /home/pi/playvideo.sh

# Configure autostart of the launch script
autostart_folder=/home/pi/.config/lxsession/LXDE-pi
mkdir -p "$autostart_folder"
cp /etc/xdg/lxsession/LXDE-pi/autostart "$autostart_folder"
echo lxterminal -e /home/pi/playvideo.sh >> "$autostart_folder/autostart"

# Turn off bluetooth (it can be re-enabled from the lxpanel)
rfkill block bluetooth

# Open chrome browser to SelfScroll extension page to install
chromium-browser https://chrome.google.com/webstore/detail/selfscroll/lofkbkbhpmeihoaogggfbhmjdekjihlf?hl=en &

# Open chrome browser to StarbaseIndy program guide (so it can be set as the startup page)
sleep 20
chromium-browser https://starbaseindy.github.io/StarbaseIndy/2019/ &
