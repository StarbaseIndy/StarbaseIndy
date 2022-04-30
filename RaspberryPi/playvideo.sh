#!/bin/sh

# get rid of the cursor so we don't see it when videos are running
setterm -cursor off

# get current screen dimensions
#eval `fbset -s | awk -F'[\"x]' '/^mode/{ print "WIDTH=" $2 "; HEIGHT=" $3  }'`
#echo "width is $WIDTH, height is $HEIGHT"
#VIDEOPATH="/home/pi/Videos"
#SERVICE="mplayer"
#OPTIONS="-framedrop -fs -nosound -nolirc -vo gl -x $WIDTH -y $HEIGHT"
#SUFFIX="-loop 0"

# notes on omxplayer: 
# H.264 format only, but uses hardware acceleration
# video must be seekable to loop (the sample test.h264 video is not seekable)
# audio stream -1 disables audio
VIDEOPATH="/home/pi/Videos-H.264"
SERVICE="omxplayer"
OPTIONS="--aspect-mode stretch --aidx -1 --blank --no-osd --loop"
SUFFIX=""

while true
do
  for FILE in $VIDEOPATH/*; do
    $SERVICE $OPTIONS "$FILE" $SUFFIX
  done
done
