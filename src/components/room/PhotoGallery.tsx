/**
 * PhotoGallery：房间照片画廊（查看 / 添加 / 删除）。
 * 照片均来自 photoDB（已带水印），通过 usePhotoUrl 生成临时 object URL 展示。
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import PhotoUpload from '../common/PhotoUpload';
import { useRoomStore } from '../../store/roomStore';
import { usePhotoUrl } from '../../hooks/usePhoto';

interface PhotoGalleryProps {
  roomId: string;
  photoIds: string[];
}

function PhotoThumb({ id, onOpen, onRemove }: { id: string; onOpen: () => void; onRemove: () => void }) {
  const url = usePhotoUrl(id);
  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        component="img"
        src={url ?? ''}
        alt="房间照片"
        onClick={onOpen}
        sx={{
          width: 96,
          height: 96,
          objectFit: 'cover',
          borderRadius: 1,
          cursor: 'pointer',
          bgcolor: '#eee',
        }}
      />
      <IconButton
        size="small"
        onClick={onRemove}
        sx={{ position: 'absolute', top: 0, right: 0, bgcolor: 'rgba(0,0,0,0.4)', color: '#fff', p: 0.3 }}
        aria-label="删除照片"
      >
        <Typography sx={{ fontSize: 12, lineHeight: 1 }}>×</Typography>
      </IconButton>
    </Box>
  );
}

export function PhotoGallery({ roomId, photoIds }: PhotoGalleryProps) {
  const addRoomPhoto = useRoomStore((s) => s.addRoomPhoto);
  const removeRoomPhoto = useRoomStore((s) => s.removeRoomPhoto);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewUrl = usePhotoUrl(previewId);

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        房间照片（{photoIds.length}）
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
        {photoIds.map((id) => (
          <PhotoThumb
            key={id}
            id={id}
            onOpen={() => setPreviewId(id)}
            onRemove={() => removeRoomPhoto(roomId, id)}
          />
        ))}
        {photoIds.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            暂无照片
          </Typography>
        )}
      </Box>

      <PhotoUpload
        label="添加房间照片（加水印）"
        onChange={(v) => {
          if (v) addRoomPhoto(roomId, v.photoId);
        }}
      />

      <Dialog open={Boolean(previewId)} onClose={() => setPreviewId(null)} maxWidth="sm" fullWidth>
        <Box sx={{ p: 1 }}>
          <Box component="img" src={previewUrl ?? ''} alt="预览" sx={{ width: '100%' }} />
        </Box>
      </Dialog>
    </Box>
  );
}

export default PhotoGallery;