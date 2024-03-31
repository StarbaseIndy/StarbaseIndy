#!/bin/bash -e

# setup_octopi.sh
#
# Instructions are here: https://community.octoprint.org/t/setting-up-octoprint-on-a-raspberry-pi-running-raspberry-pi-os-debian/2337
#
# You can use this script directly:
# curl -s https://raw.githubusercontent.com/StarbaseIndy/StarbaseIndy/master/RaspberryPi/LePotato/octopi_setup/setup_octopi.sh | bash -s
#

INSTALL_DIR=`pwd`
CONFIG=~/.octoprint/config.yaml
IP_ADDR=`ifconfig wlan0 | sed -En 's/127.0.0.1//;s/.*inet (addr:)?(([0-9]*\.){3}[0-9]*).*/\2/p'`


################################################################################
# Download Resources
################################################################################
function download_resources {
  echo NOTICE: Downloading resources
  curl -s -O https://raw.githubusercontent.com/StarbaseIndy/StarbaseIndy/master/RaspberryPi/LePotato/octopi_setup/webcamDaemon_video0
  curl -s -O https://raw.githubusercontent.com/StarbaseIndy/StarbaseIndy/master/RaspberryPi/LePotato/octopi_setup/webcamd.service
  curl -s -O https://raw.githubusercontent.com/StarbaseIndy/StarbaseIndy/master/RaspberryPi/LePotato/octopi_setup/octoprint.service
  curl -s -O https://raw.githubusercontent.com/StarbaseIndy/StarbaseIndy/master/RaspberryPi/LePotato/octopi_setup/haproxy_2.x.cfg
}

################################################################################
# Basic Installation
################################################################################
function basic_installation {
  # For the basic package you'll need Python 3.7, 3.8, 3.9 or 3.10 (one of these is probably installed by default) and pip.
  # Make sure you are using the correct version - it is probably be installed as python3, not python. To check:
  echo NOTICE: Performing basic installation
  python3 --version

  # Installing OctoPrint should be done within a virtual environment, rather than
  # an OS wide install, to help prevent dependency conflicts. To setup Python,
  # dependencies and the virtual environment, run the following.

  cd ~
  sudo apt update
  sudo apt install python3 python3-pip python3-dev python3-setuptools python3-venv git libyaml-dev build-essential libffi-dev libssl-dev
  mkdir OctoPrint
  cd OctoPrint
  python3 -m venv venv
  source venv/bin/activate

  # OctoPrint and it's Python dependencies can then be installed using pip:

  pip install --upgrade pip wheel
  pip install octoprint

  # You may need to add the pi user to the dialout group and tty so that the user can access the serial ports, before starting OctoPrint:

  sudo usermod -a -G tty pi
  sudo usermod -a -G dialout pi
}

################################################################################
# Automatic start-up
################################################################################
function automatic_startup {
  # Download the init script files from OctoPrint's repository, move them to their
  # respective folders and make the init script executable:
  echo NOTICE: Configuring automatic startup
  cd $INSTALL_DIR

  # rm -f ./octoprint.service
  # wget https://github.com/OctoPrint/OctoPrint/raw/master/scripts/octoprint.service
  grep -q 'ExecStart=/home/pi/OctoPrint/venv/bin/octoprint' ./octoprint.service || {
    echo 'FIX ExecStart!'
    exit -1
  }

  sudo cp ./octoprint.service /etc/systemd/system/octoprint.service

  # Then add the script to autostart:
  sudo systemctl enable octoprint.service
}

################################################################################
# Enable port 80
################################################################################
function enable_port_80 {
  echo NOTICE: Enabling port 80

  # Setup on Raspbian is as follows:
  sudo service haproxy stop || true

  sudo apt install haproxy
  sudo cp ./haproxy_2.x.cfg /etc/haproxy/haproxy.cfg
  sudo service haproxy start
  systemctl status haproxy
}

################################################################################
# Support restart/shutdown through OctoPrint's system menu
################################################################################
function octopi_system_menu {
  echo NOTICE: Configuring octopi system menu

  sudo service octoprint stop || true

  # TODO: Edit ~/.octoprint/config.yaml to add a server configuration:
  if [ ! -e $CONFIG ]; then
    mkdir -p "$(dirname $CONFIG)"
    cat <<CONFIG_EOF > $CONFIG
server:
  host: 127.0.0.1
  commands:
    serverRestartCommand: sudo service octoprint restart
    systemRestartCommand: sudo shutdown -r now
    systemShutdownCommand: sudo shutdown -h now
plugins:
  classicwebcam:
    _config_version: 1
    snapshot: http://127.0.0.1:8080/?action=snapshot
    stream: /webcam/?action=stream
system:
  actions:
   - action: streamon
     command: sudo systemctl start webcamd
     confirm: false
     name: Start video stream
   - action: streamoff
     command: sudo systemctl stop webcamd
     confirm: false
     name: Stop video stream
webcam:
  ffmpeg: /usr/bin/ffmpeg
CONFIG_EOF
  else
    echo WARNING: configure server/host AND webcam stream URL AND restart commands in $CONFIG
  fi

  # Start the octoprint service
  sudo service octoprint start

  echo NOTICE: octoprint is now running at http://$IP_ADDR

  read -n 1 -p "Please configure the octopi web interface NOW, then press ENTER to continue."
}


################################################################################
# Webcam configuration and automatic startup
################################################################################
function webcam_config {
  echo NOTICE: Configuring webcam

  sudo systemctl stop webcamd || true
  sudo systemctl disable webcamd || true

  # If you also want webcam and timelapse support, you'll need to download and compile MJPG-Streamer:
  cd ~
  sudo apt install subversion libjpeg62-turbo-dev imagemagick ffmpeg libv4l-dev cmake libraspberrypi-bin
  if [ ! -e mjpg-streamer ]; then
    git clone https://github.com/jacksonliam/mjpg-streamer.git
  fi
  cd mjpg-streamer/mjpg-streamer-experimental
  export LD_LIBRARY_PATH=.
  make

  # Set up service and daemon:
  cd $INSTALL_DIR
  DAEMON_SCRIPT=/home/pi/scripts/webcamDaemon
  mkdir -p "$(dirname $DAEMON_SCRIPT)"
  sudo cp ./webcamd.service /etc/systemd/system/webcamd.service
  cp ./webcamDaemon_video0 $DAEMON_SCRIPT
  chmod +x $DAEMON_SCRIPT

  # Tell the system to read the new file:
  sudo systemctl daemon-reload

  # And finally enable the service:
  sudo systemctl enable webcamd

  # The webcam should automatically start on boot, but it can also be started manually:
  sudo systemctl start webcamd
  systemctl status webcamd

  # list capabilities of all video devices
  ls -d /dev/* | grep video | xargs -L1 -d '\n' sh -c 'echo $0 && v4l2-ctl --list-formats-ext -d $0'
}


################################################################################
# Install octoprint plugins
################################################################################
function install_octoprint_plugins {
  echo NOTICE: Installing plugins

  source ~/OctoPrint/venv/bin/activate

  # Change Filament plugin
  pip install https://github.com/jim-p/Change_Filament/archive/master.zip

  # ipOnConnect
  pip install https://github.com/jneilliii/OctoPrint-ipOnConnect/archive/master.zip

  # Extra File Info
  pip install https://github.com/larsjuhw/OctoPrint-Extrafileinfo/archive/master.zip

  # Display Layer Progress
  pip install https://github.com/OllisGit/OctoPrint-DisplayLayerProgress/releases/latest/download/master.zip

  # Tab Order
  pip install https://github.com/jneilliii/OctoPrint-TabOrder/archive/master.zip

  # Slicer Settings Tab
  pip install https://github.com/larsjuhw/OctoPrint-SlicerSettingsTab/archive/master.zip

  # Slicer Settings Parser
  pip install https://github.com/larsjuhw/OctoPrint-SlicerSettingsParser/archive/master.zip

  # FileManager
  pip install https://github.com/Salandora/OctoPrint-FileManager/archive/master.zip

  # OctoApp
  pip install https://github.com/crysxd/OctoApp-Plugin/archive/refs/heads/release.zip

  # Octolapse
  pip install https://github.com/FormerLurker/Octolapse/archive/master.zip

  # Bed Level Visualizer
  pip install https://github.com/jneilliii/OctoPrint-BedLevelVisualizer/archive/master.zip

  # Malyan Connection Fix Plugin
  # pip install https://github.com/OctoPrint/OctoPrint-MalyanConnectionFix/archive/master.zip

  # Dragon Order
  # pip install https://github.com/jneilliii/OctoPrint-DragonOrder/archive/master.zip

  sudo service octoprint restart
}


################################################################################
# main
################################################################################

PWD=`pwd`
echo PWD:$PWD

download_resources
basic_installation
automatic_startup
enable_port_80
octopi_system_menu
webcam_config
install_octoprint_plugins

